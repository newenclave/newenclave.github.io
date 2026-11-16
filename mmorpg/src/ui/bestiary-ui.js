import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { MAX_TIER } from '../systems/difficulty.js';
import { drawEnemySprite, enemyFitScale } from '../render/sprites.js';
import {
  TABS, entriesFor, knowledge, progress, traits, whereFound, LEARN_STATS_AT, LEARN_LOOT_AT,
} from '../systems/bestiary.js';

// Same scaled "design space" approach as the other windows.
const DW = 690;
const DH = 470;
const CARD = { x: 30, y: 106, w: 100, h: 62, gap: 6, cols: 3 };
const TAB = { x: 30, y: 62, w: 120, h: 30, gap: 6 };
const DETAIL = { x: 360, y: 62, w: 300, h: 380 };
const CLOSE = { x: DW - 34, y: 34, r: 20 };
const MIN_TOUCH_R = 22;
export const MAX_CARDS = 15; // the grid holds this many per tab

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const tabRect = (i) => ({ x: TAB.x + i * (TAB.w + TAB.gap), y: TAB.y, w: TAB.w, h: TAB.h });
const cardRect = (i) => ({
  x: CARD.x + (i % CARD.cols) * (CARD.w + CARD.gap), y: CARD.y + Math.floor(i / CARD.cols) * (CARD.h + CARD.gap), w: CARD.w, h: CARD.h,
});

export const currentTab = (state) => (TABS.includes(state.ui.bestiaryTab) ? state.ui.bestiaryTab : 'monsters');

export function hitBestiary(state, mx, my, w, h) {
  const v = view(w, h);
  const cx = v.ox + CLOSE.x * v.k;
  const cy = v.oy + CLOSE.y * v.k;
  if (Math.hypot(mx - cx, my - cy) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  for (let i = 0; i < TABS.length; i++) if (inside(tabRect(i), x, y)) return { kind: 'tab', tab: TABS[i] };
  const entries = entriesFor(state, currentTab(state)).slice(0, MAX_CARDS);
  for (let i = 0; i < entries.length; i++) if (inside(cardRect(i), x, y)) return { kind: 'card', id: entries[i].id };
  return null;
}

// What a click does (kept apart from drawing so that it can be tested).
export function clickBestiary(state, region) {
  if (region.kind === 'tab') {
    state.ui.bestiaryTab = region.tab;
    state.ui.bestiarySel = entriesFor(state, region.tab)[0]?.id ?? null;
  } else if (region.kind === 'card') {
    state.ui.bestiarySel = region.id;
  }
}

const stars = (tier) => '★'.repeat(tier + 1) + '☆'.repeat(MAX_TIER - tier);

// The monster's picture in a box px wide; a dark shape until you have met it. False when it has no picture.
function drawPortrait(ctx, def, seen, x, y, px) {
  const scale = enemyFitScale(def, px);
  return scale > 0 && !!drawEnemySprite(ctx, def, x, y, { scale, fx: 1, fy: 1, flash: seen ? false : '#2a2a32', outline: seen ? undefined : '#3a3a46' });
}

function drawCard(ctx, state, entry, rect, selected) {
  const k = knowledge(state, entry.id);
  ctx.fillStyle = selected ? '#33334a' : '#1c1c28';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.lineWidth = selected ? 3 : 2;
  ctx.strokeStyle = selected ? '#ffd54f' : k.seen ? '#58648a' : '#333';
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  if (!drawPortrait(ctx, entry.def, k.seen, rect.x + 24, rect.y + 30, 40)) {
    ctx.fillStyle = k.seen ? entry.def.color : '#2a2a32';
    ctx.beginPath();
    ctx.arc(rect.x + 24, rect.y + 28, entry.kind === 'boss' ? 17 : 14, 0, Math.PI * 2);
    ctx.fill();
  }
  if (k.seen && entry.def.flying && !enemyFitScale(entry.def, 40)) { // wings
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rect.x + 8, rect.y + 20); ctx.lineTo(rect.x + 24, rect.y + 28); ctx.lineTo(rect.x + 40, rect.y + 20);
    ctx.stroke();
  }
  if (!k.seen) {
    ctx.fillStyle = '#666';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', rect.x + 24, rect.y + 35);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = k.seen ? '#fff' : '#777';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(k.seen ? t('bestiary.name.' + entry.id) : '???', rect.x + 46, rect.y + 24, rect.w - 50);
  ctx.fillStyle = '#aaa';
  ctx.font = '11px sans-serif';
  ctx.fillText(k.seen ? t('bestiary.defeated', { n: k.kills }) : '', rect.x + 46, rect.y + 40, rect.w - 50);
  if (k.seen && entry.kind === 'boss') {
    ctx.fillStyle = '#ffd54f';
    ctx.fillText('★', rect.x + rect.w - 16, rect.y + 14);
  }
}

function drawDetail(ctx, state, entry) {
  const k = knowledge(state, entry.id);
  const d = entry.def;
  const x = DETAIL.x + 16;
  let y = DETAIL.y + 34;

  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h);

  if (!drawPortrait(ctx, d, k.seen, DETAIL.x + DETAIL.w - 48, DETAIL.y + 48, 64)) {
    ctx.fillStyle = k.seen ? d.color : '#2a2a32';
    ctx.beginPath();
    ctx.arc(DETAIL.x + DETAIL.w - 44, DETAIL.y + 46, entry.kind === 'boss' ? 28 : 22, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(k.seen ? t('bestiary.name.' + entry.id) : '???', x, y, DETAIL.w - 100);
  y += 24;
  if (!k.seen) {
    ctx.fillStyle = '#9e9e9e';
    ctx.font = '14px sans-serif';
    ctx.fillText(t('bestiary.unknown'), x, y + 8, DETAIL.w - 32);
    return;
  }

  // how it fights
  ctx.font = '12px sans-serif';
  let cx = x;
  for (const tag of traits(entry)) {
    const label = t('bestiary.tag.' + tag);
    const width = ctx.measureText(label).width + 14;
    ctx.fillStyle = tag === 'flying' ? '#1565c0' : tag === 'boss' || tag === 'dungeonBoss' ? '#8e2b2b' : '#3a3f55';
    ctx.fillRect(cx, y, width, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx + 7, y + 14);
    cx += width + 6;
  }
  y += 40;

  // where it lives
  const where = whereFound(state, entry);
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('bestiary.where'), x, y);
  y += 20;
  ctx.fillStyle = '#eee';
  ctx.font = '14px sans-serif';
  if (where.guards) {
    ctx.fillText(t('bestiary.guards', { name: t('dungeon.theme.' + where.guards) }), x, y, DETAIL.w - 32);
    y += 20;
  } else {
    ctx.fillText(where.biomes.map((b) => t('biome.' + b)).join(', '), x, y, DETAIL.w - 32);
    y += 20;
  }
  ctx.fillStyle = '#ffcc80';
  ctx.fillText(`${stars(where.tier)}  ${t('bestiary.fromTiles', { n: where.fromTiles })}`, x, y, DETAIL.w - 32);
  y += 20;
  if (entry.kind === 'boss' && !d.dungeon) {
    ctx.fillStyle = '#eee';
    ctx.fillText(t('bestiary.lair'), x, y, DETAIL.w - 32);
    y += 20;
  }
  if (where.dungeons.length) {
    ctx.fillStyle = '#ce93d8';
    ctx.fillText(t('bestiary.alsoIn', { names: where.dungeons.map((n) => t('dungeon.theme.' + n)).join(', ') }), x, y, DETAIL.w - 32);
    y += 20;
  }
  y += 10;

  // what you have learned about its strength
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('bestiary.strength'), x, y);
  y += 20;
  ctx.fillStyle = '#eee';
  ctx.font = '14px sans-serif';
  if (k.stats) {
    ctx.fillText(t('bestiary.stats', { hp: d.hp, damage: d.damage, speed: d.speed }), x, y, DETAIL.w - 32);
  } else {
    ctx.fillStyle = '#777';
    ctx.fillText(t('bestiary.learnStats', { n: LEARN_STATS_AT }), x, y, DETAIL.w - 32);
  }
  y += 20;
  if (d.flying) {
    ctx.fillStyle = '#81d4fa';
    ctx.fillText(t('bestiary.flyingNote'), x, y, DETAIL.w - 32);
    y += 20;
  }
  y += 10;

  // loot
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('bestiary.loot'), x, y);
  y += 20;
  ctx.font = '14px sans-serif';
  if (k.loot) {
    ctx.fillStyle = '#eee';
    ctx.fillText(t(entry.kind === 'boss' ? 'bestiary.lootBoss' : 'bestiary.lootMonster', { lo: d.gold[0], hi: d.gold[1] }), x, y, DETAIL.w - 32);
  } else {
    ctx.fillStyle = '#777';
    ctx.fillText(t('bestiary.learnLoot', { n: LEARN_LOOT_AT }), x, y, DETAIL.w - 32);
  }
  y += 30;

  // what it really is (docs/story.md), once you have beaten one
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('bestiary.truth'), x, y);
  y += 20;
  ctx.font = 'italic 14px serif';
  ctx.fillStyle = k.stats ? '#d7ccc8' : '#777';
  const truth = k.stats ? t('bestiary.lore.' + entry.id) : t('bestiary.truthLocked');
  wrapText(ctx, truth, DETAIL.w - 32).slice(0, 4).forEach((line, i) => ctx.fillText(line, x, y + i * 17));
}

export function drawBestiary(ctx, state, w, h) {
  const v = view(w, h);
  const tab = currentTab(state);
  const entries = entriesFor(state, tab).slice(0, MAX_CARDS);
  const selected = entries.find((e) => e.id === state.ui.bestiarySel) ?? null;

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);
  ctx.fillStyle = 'rgba(10,10,20,0.94)';
  ctx.fillRect(0, 0, DW, DH);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(t('bestiary.title'), DW / 2, 38);
  const { seen, total } = progress(state);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('bestiary.progress', { seen, total }), 30, 38);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  TABS.forEach((name, i) => {
    const r = tabRect(i);
    ctx.fillStyle = name === tab ? '#3d4b73' : '#222838';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = name === tab ? '#ffd54f' : '#444c66';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('bestiary.tab.' + name), r.x + r.w / 2, r.y + 20);
  });
  ctx.textAlign = 'left';

  entries.forEach((entry, i) => drawCard(ctx, state, entry, cardRect(i), entry === selected));
  if (selected) drawDetail(ctx, state, selected);
  ctx.restore();
  ctx.textAlign = 'left';
}
