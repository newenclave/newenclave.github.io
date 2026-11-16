import { t } from '../core/i18n.js';
import { TILE } from '../world/world.js';
import { rarityById } from '../sim/loot.js';
import { MAX_ACTIVE, activeQuests, completedCount, turnInTown } from '../systems/quests.js';
import { objectiveText, questTitle } from './quest-ui.js';
import { itemName } from './inventory-ui.js';
import { mmss, wrapText } from '../core/format.js';
import { hasItem } from '../systems/sidequests.js';
import { drawChronicle, PAGE_BTNS } from './chronicle-ui.js';
import { drawRelics } from './relics-ui.js';

// Same scaled "design space" approach as the other panels.
const DW = 690;
const DH = 470;
const ROW = { x: 30, y: 68, w: 330, h: 58, gap: 4 };
const DETAIL = { x: 380, y: 68, w: 280, h: 312 };
const BTN_ABANDON = { x: 380, y: 394, w: 280, h: 40 };
const CLOSE = { x: DW - 34, y: 34, r: 20 };
// two pages: the quests you are on, and the chronicle of what you have learned about the world
const TABS = { quests: { x: 30, y: 16, w: 100, h: 30 }, chronicle: { x: 136, y: 16, w: 100, h: 30 }, relics: { x: 242, y: 16, w: 90, h: 30 } };
const MIN_TOUCH_R = 22;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const rowY = (i) => ROW.y + i * (ROW.h + ROW.gap);
const inside = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function hitJournal(state, mx, my, w, h) {
  const v = view(w, h);
  const cx = v.ox + CLOSE.x * v.k;
  const cy = v.oy + CLOSE.y * v.k;
  if (Math.hypot(mx - cx, my - cy) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  for (const [tab, r] of Object.entries(TABS)) if (inside(r, x, y)) return { kind: 'tab', tab };
  if (state.ui.journalTab === 'chronicle') {
    for (const [page, r] of Object.entries(PAGE_BTNS)) if (inside(r, x, y)) return { kind: 'page', step: page === 'next' ? 1 : -1 };
    return null;
  }
  if (state.ui.journalTab === 'relics') return null;
  const list = activeQuests(state);
  for (let i = 0; i < list.length && i < MAX_ACTIVE; i++) {
    if (inside({ x: ROW.x, y: rowY(i), w: ROW.w, h: ROW.h }, x, y)) return { kind: 'row', id: list[i].def.id };
  }
  if (inside(BTN_ABANDON, x, y)) return { kind: 'abandon' };
  return null;
}

function arrow(ctx, x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, size * 0.7);
  ctx.lineTo(-size * 0.3, 0);
  ctx.lineTo(-size * 0.7, -size * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function progressBar(ctx, x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), 8);
}

export function drawJournal(ctx, state, w, h) {
  const v = view(w, h);
  const p = state.player;
  const list = activeQuests(state);
  const sel = list.find((q) => q.def.id === state.ui.journalSel) ?? null;

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);

  ctx.fillStyle = 'rgba(10,10,20,0.94)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  const tab = state.ui.journalTab ?? 'quests';
  const chronicle = tab === 'chronicle';
  ctx.fillText(t({ chronicle: 'chron.title', relics: 'relic.title' }[tab] ?? 'journal.title'), DW / 2 + 60, 38);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  ctx.font = 'bold 13px sans-serif';
  for (const [name, r] of Object.entries(TABS)) {
    const on = name === (state.ui.journalTab ?? 'quests');
    ctx.fillStyle = on ? '#33415c' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = on ? '#fff' : '#999';
    ctx.fillText(t('journal.tab.' + name), r.x + r.w / 2, r.y + 20);
  }
  if (chronicle || tab === 'relics') {
    if (chronicle) drawChronicle(ctx, state, state.overworld?.world ?? state.world); // below ground it still reads the open world
    else drawRelics(ctx, state);
    ctx.restore();
    ctx.textAlign = 'left';
    return;
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#bbb';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('journal.active', { n: list.length, max: MAX_ACTIVE }), ROW.x, ROW.y - 10);

  list.slice(0, MAX_ACTIVE).forEach(({ def, entry }, i) => {
    const y = rowY(i);
    const tracked = def.id === p.tracked;
    const ready = entry.progress >= def.count;
    ctx.fillStyle = def === sel?.def ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(ROW.x, y, ROW.w, ROW.h);
    if (tracked) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(ROW.x + 1, y + 1, ROW.w - 2, ROW.h - 2);
    }
    ctx.fillStyle = tracked ? '#ffd54f' : '#555';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('★', ROW.x + 10, y + 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(questTitle(def), ROW.x + 36, y + 22);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = ready ? '#9ccc65' : '#bbb';
    ctx.fillText(ready ? t('journal.ready') : objectiveText(def), ROW.x + 36, y + 40);
    if (def.kind === 'kill') progressBar(ctx, ROW.x + 36, y + 46, ROW.w - 50, entry.progress / def.count, ready ? '#9ccc65' : '#42a5f5');
  });
  if (list.length === 0) {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.fillText(t('journal.empty'), ROW.x, ROW.y + 20);
  }
  ctx.fillStyle = '#888';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('journal.completed', { n: completedCount(state) }), ROW.x, 410);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h);
  if (sel) drawDetail(ctx, state, sel);
  else {
    ctx.fillStyle = '#888';
    ctx.font = '14px sans-serif';
    ctx.fillText(t('journal.hint'), DETAIL.x + 14, DETAIL.y + 28);
  }

  if (sel) {
    const armed = state.ui.abandonArmed === sel.def.id;
    ctx.fillStyle = armed ? '#8e2b2b' : '#3a2a2a';
    ctx.fillRect(BTN_ABANDON.x, BTN_ABANDON.y, BTN_ABANDON.w, BTN_ABANDON.h);
    ctx.strokeStyle = armed ? '#ff5252' : '#7a4a4a';
    ctx.lineWidth = 2;
    ctx.strokeRect(BTN_ABANDON.x, BTN_ABANDON.y, BTN_ABANDON.w, BTN_ABANDON.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t(armed ? 'journal.abandon.confirm' : 'journal.abandon'), BTN_ABANDON.x + BTN_ABANDON.w / 2, BTN_ABANDON.y + 25);
    ctx.textAlign = 'left';
  }

  ctx.restore();
  ctx.textAlign = 'left';
}

function drawDetail(ctx, state, { def, entry }) {
  const p = state.player;
  const x = DETAIL.x + 14;
  let y = DETAIL.y + 30;
  const ready = entry.progress >= def.count;

  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(questTitle(def), x, y);
  y += 26;
  ctx.fillStyle = '#eee';
  ctx.font = '14px sans-serif';
  ctx.fillText(objectiveText(def), x, y);
  y += 20;
  const rest = def.lair ? state.lairs?.get(def.lair)?.respawn ?? 0 : 0;
  if (rest > 0 && !ready) { // its boss is away
    ctx.fillStyle = '#ffcc80';
    ctx.font = '12px sans-serif';
    ctx.fillText(t('journal.resting', { time: mmss(rest) }), x, y + 14);
    ctx.fillStyle = '#eee';
    ctx.font = '14px sans-serif';
    y += 18;
  }
  if (def.kind === 'kill' || def.kind === 'gather') {
    progressBar(ctx, x, y, DETAIL.w - 28, entry.progress / def.count, ready ? '#9ccc65' : '#42a5f5');
    ctx.fillStyle = ready ? '#9ccc65' : '#ccc';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${entry.progress} / ${def.count}`, x, y + 24);
    y += 40;
  } else {
    ctx.fillStyle = ready ? '#9ccc65' : '#ccc';
    ctx.font = '13px sans-serif';
    ctx.fillText(t(ready ? 'journal.arrived' : 'journal.travelling'), x, y + 8);
    y += 30;
  }

  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('journal.reward'), x, y);
  y += 20;
  const r = def.reward ?? {};
  ctx.font = '14px sans-serif';
  if (r.gold) { ctx.fillStyle = '#ffd54f'; ctx.fillText(t('hud.gold', { n: r.gold }), x, y); y += 20; }
  if (r.xp) { ctx.fillStyle = '#90caf9'; ctx.fillText(t('quest.xp', { n: r.xp }), x, y); y += 20; }
  if (r.item) {
    ctx.fillStyle = rarityById(r.item.rarity).color;
    ctx.fillText(`${t('rarity.' + r.item.rarity)} ${itemName({ slot: r.item.slot, id: r.item.id })}`, x, y);
    y += 20;
  }

  // what you carry for it (a book, a letter, a hammer): its name and what it is, to read again
  const bottom = DETAIL.y + DETAIL.h - 64;
  for (const it of new Set([def.gives, def.takes].flat().filter(Boolean))) {
    if (!hasItem(state, it) || y > bottom - 20) continue;
    y += 6;
    ctx.fillStyle = '#e0c890';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(t(`item.${it}.name`), x, y);
    y += 16;
    ctx.fillStyle = '#bdb2a0';
    ctx.font = 'italic 12px serif';
    for (const line of wrapText(ctx, t(`item.${it}.desc`), DETAIL.w - 28)) {
      if (y > bottom) break;
      ctx.fillText(line, x, y);
      y += 14;
    }
  }

  // where to hand in, with the direction and distance from where you stand
  const town = state.world?.getTownById(turnInTown(def));
  y = Math.max(y + 10, DETAIL.y + DETAIL.h - 58);
  ctx.fillStyle = '#9e9e9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('journal.handin'), x, y);
  if (town) {
    const dx = town.px - p.x;
    const dy = town.py - p.y;
    const tiles = Math.round(Math.hypot(dx, dy) / TILE);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(t('town.name.' + town.nameIndex), x + 26, y + 22);
    ctx.fillStyle = '#bbb';
    ctx.font = '13px sans-serif';
    ctx.fillText(state.town?.id === town.id ? t('journal.here') : t('journal.distance', { n: tiles }), x + 26 + 130, y + 22);
    if (state.town?.id !== town.id) arrow(ctx, x + 9, y + 17, Math.atan2(dy, dx), 9, '#ffd54f');
  }
}
