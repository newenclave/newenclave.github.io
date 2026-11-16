import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { ENDINGS } from '../systems/ring.js';

// The console of the Ring: the last choice of the story, side by side. Same scaled "design space" as the other panels.
const DW = 690;
const DH = 470;
const CLOSE = { x: DW - 34, y: 34, r: 20 };
const MIN_TOUCH_R = 22;
const CARD = { y: 168, w: 300, h: 286 };
const cardX = (i) => 30 + i * (CARD.w + 30);
const BTN = { h: 44, inset: 20 };
const button = (i) => ({ x: cardX(i) + BTN.inset, y: CARD.y + CARD.h - BTN.h - 16, w: CARD.w - 2 * BTN.inset, h: BTN.h });

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

export function hitEnding(mx, my, w, h) {
  const v = view(w, h);
  if (Math.hypot(mx - (v.ox + CLOSE.x * v.k), my - (v.oy + CLOSE.y * v.k)) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  for (let i = 0; i < ENDINGS.length; i++) {
    const b = button(i);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'choose', choice: ENDINGS[i] };
  }
  return null;
}

// `roster`: the Night Shift set is complete, and the console reads out the roster of your shift instead.
export function drawEnding(ctx, w, h, roster = false) {
  const v = view(w, h);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);
  ctx.fillStyle = 'rgba(14,8,24,0.96)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.strokeStyle = '#ce93d8';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, DW - 12, DH - 12);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#e1bee7';
  ctx.font = 'bold 22px serif';
  ctx.fillText(t('ending.panel.title'), DW / 2, 42);
  ctx.fillStyle = '#d7ccc8';
  ctx.font = 'italic 15px serif';
  // the console knows you (all of it, if you carry the whole night shift), and then what is at stake: the warning that
  // nobody can choose again is always there
  const intro = [roster ? t('console.roster.0') + ' ' + t('console.roster.1') : t('console.roster.0'), t('ending.panel.text')].join(' ');
  wrapText(ctx, intro, DW - 80).slice(0, 5).forEach((line, i) => ctx.fillText(line, DW / 2, 72 + i * 19));

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  ENDINGS.forEach((choice, i) => {
    const x = cardX(i);
    ctx.fillStyle = choice === 'fold' ? 'rgba(144,202,249,0.08)' : 'rgba(206,147,216,0.1)';
    ctx.fillRect(x, CARD.y, CARD.w, CARD.h);
    ctx.fillStyle = choice === 'fold' ? '#90caf9' : '#ce93d8';
    ctx.font = 'bold 18px serif';
    ctx.fillText(t(`ending.${choice}.name`), x + CARD.w / 2, CARD.y + 32);
    ctx.fillStyle = '#e0d6c2';
    ctx.font = '14px serif';
    wrapText(ctx, t(`ending.${choice}.desc`), CARD.w - 30).slice(0, 9).forEach((line, k) => ctx.fillText(line, x + CARD.w / 2, CARD.y + 62 + k * 18));
    const b = button(i);
    ctx.fillStyle = choice === 'fold' ? '#1e3a5c' : '#4a2358';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = choice === 'fold' ? '#90caf9' : '#ce93d8';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(t(`ending.${choice}.button`), b.x + b.w / 2, b.y + 28);
  });
  ctx.restore();
  ctx.textAlign = 'left';
}
