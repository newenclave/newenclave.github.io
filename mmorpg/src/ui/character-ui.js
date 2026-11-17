// The character sheet (key C): the seven attributes with a "+" for each free point, what the selected one does, and
// what the hero adds up to. Laid out in "design" coordinates and scaled to fit any screen, like the skill tree.
import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { ATTRS, attrOf, canRaise } from '../systems/attributes.js';
import { hitAmount } from '../sim/combat.js';
import { sightOf } from '../systems/explore.js';
import { MAX_BARTER } from '../systems/economy.js';

const DW = 640;
const DH = 450;
const CLOSE = { x: DW - 34, y: 34, r: 20 };
const ROW_X = 28;
const ROW_W = 300;
const ROW_Y = 70;
const ROW_H = 40;
const PLUS = { dx: ROW_W - 40, w: 38, h: 32 };
const DESC_Y = ROW_Y + ATTRS.length * ROW_H + 12;
const MIN_TOUCH = 22;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const toDesign = (v, x, y) => ({ x: (x - v.ox) / v.k, y: (y - v.oy) / v.k });
const rowY = (i) => ROW_Y + i * ROW_H;

// The "+" next to an attribute, in design coordinates.
const plusRect = (i) => ({ x: ROW_X + PLUS.dx, y: rowY(i) + (ROW_H - PLUS.h) / 2, w: PLUS.w, h: PLUS.h });

// What is under (mx, my) on the screen: { kind: 'close' } | { kind: 'plus', id } | { kind: 'row', id } | null.
export function hitCharacter(state, mx, my, w, h) {
  const v = view(w, h);
  const d = toDesign(v, mx, my);
  const slop = Math.max(0, MIN_TOUCH / v.k - CLOSE.r);
  if (Math.hypot(d.x - CLOSE.x, d.y - CLOSE.y) <= CLOSE.r + slop) return { kind: 'close' };
  for (let i = 0; i < ATTRS.length; i++) {
    const id = ATTRS[i];
    const r = plusRect(i);
    const pad = Math.max(0, (MIN_TOUCH * 2 / v.k - r.h) / 2);
    if (canRaise(state.player, id) && d.x >= r.x - pad && d.x <= r.x + r.w + pad && d.y >= r.y - pad && d.y <= r.y + r.h + pad) return { kind: 'plus', id };
    if (d.x >= ROW_X && d.x <= ROW_X + ROW_W && d.y >= rowY(i) && d.y < rowY(i) + ROW_H) return { kind: 'row', id };
  }
  return null;
}

const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

// What the hero adds up to, as [label key, value] pairs.
export function heroLines(state) {
  const p = state.player;
  const s = p.stats;
  const w = p.weapon;
  return [
    ['hero.stat.hp', String(Math.round(p.maxHp))],
    ['hero.stat.regen', `${s.regen >= 0 ? '+' : ''}${s.regen.toFixed(1)}/s`],
    ['hero.stat.damage', w ? String(Math.round(hitAmount(p, w))) : '-'],
    ['hero.stat.speed', pct(s.attackSpeed)],
    ['hero.stat.crit', `${Math.round(s.critChance * 100)}%`],
    ['hero.stat.tough', pct(-s.toughness)],
    ['hero.stat.roll', pct(-s.rollCooldown)],
    ['hero.stat.sight', String(sightOf(state))],
    ['hero.stat.range', pct(s.range)],
    ['hero.stat.loot', pct(s.rarityLuck)],
    ['hero.stat.gold', pct(s.goldFind)],
    ['hero.stat.prices', pct(-Math.max(-MAX_BARTER, Math.min(MAX_BARTER, s.barter)))],
    ['hero.stat.rewards', pct(Math.max(0, s.rewardBonus))],
  ];
}

export function drawCharacter(ctx, state, w, h) {
  const p = state.player;
  const v = view(w, h);
  const touchMode = state.touch?.recent(5000);
  const hover = touchMode ? null : hitCharacter(state, state.mouse.x, state.mouse.y, w, h);
  const focus = hover?.id ?? state.ui.selectedAttr ?? null;
  const colors = new Map((state.attrDefs ?? []).map((a) => [a.id, a.color]));

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);
  ctx.fillStyle = 'rgba(10,10,20,0.94)';
  ctx.fillRect(0, 0, DW, DH);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(t('hero.title', { level: p.level }), DW / 2, 36);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = p.attrPoints > 0 ? '#ffd54f' : '#9e9e9e';
  ctx.fillText(t('hero.points', { n: p.attrPoints | 0 }), DW / 2, 56);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  // the attributes
  ctx.textBaseline = 'middle';
  ATTRS.forEach((id, i) => {
    const y = rowY(i);
    if (id === focus) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(ROW_X - 6, y + 2, ROW_W + 12, ROW_H - 4);
    }
    ctx.fillStyle = colors.get(id) ?? '#fff';
    ctx.fillRect(ROW_X, y + ROW_H / 2 - 6, 12, 12);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#eee';
    ctx.fillText(t('attr.' + id), ROW_X + 22, y + ROW_H / 2);
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = attrOf(p, id) > 3 ? '#a5d6a7' : attrOf(p, id) < 3 ? '#ef9a9a' : '#fff';
    ctx.fillText(String(attrOf(p, id)), ROW_X + PLUS.dx - 16, y + ROW_H / 2);
    if (canRaise(p, id)) {
      const r = plusRect(i);
      ctx.fillStyle = 'rgba(255,213,79,0.25)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('+', r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
  });

  // what the hero adds up to
  const sx = ROW_X + ROW_W + 40;
  ctx.font = '14px sans-serif';
  heroLines(state).forEach(([key, value], i) => {
    const y = ROW_Y + 10 + i * 22;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#bdbdbd';
    ctx.fillText(t(key), sx, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(value, DW - 28, y);
  });

  // what the selected attribute does
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#e0e0e0';
  const text = focus ? t('attr.' + focus + '.desc') : t(touchMode ? 'hero.hint.touch' : 'hero.hint');
  wrapText(ctx, text, DW - 2 * ROW_X).slice(0, 3).forEach((line, i) => ctx.fillText(line, ROW_X, DESC_Y + 16 + i * 18));
  ctx.restore();
  ctx.textAlign = 'left';
}
