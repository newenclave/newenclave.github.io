// Making the hero (docs/character.md, section 5): after "New Game" and before the prologue. Seven attributes with
// - and +, what the selected one does, how many points are left, and Begin. The world waits while this is open.
// Laid out in "design" coordinates and scaled to fit any screen, like the character sheet.
import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { ATTRS, BASE, canAdjust, draftLeft } from '../systems/attributes.js';

const DW = 640;
const DH = 450;
const ROW_X = 28;
const ROW_W = 320;
const ROW_Y = 96;
const ROW_H = 38;
const BTN = { w: 36, h: 30 };
const MINUS_X = ROW_X + 196;
const PLUS_X = ROW_X + 276;
const VALUE_X = (MINUS_X + BTN.w + PLUS_X) / 2;
const SIDE_X = ROW_X + ROW_W + 32;
const RESET = { x: ROW_X, y: 384, w: 140, h: 44 };
const BEGIN = { x: DW - 28 - 180, y: 384, w: 180, h: 44 };
const MIN_TOUCH = 22;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const rowY = (i) => ROW_Y + i * ROW_H;
const btnRect = (x, i) => ({ x, y: rowY(i) + (ROW_H - BTN.h) / 2, w: BTN.w, h: BTN.h });

function inside(r, d, pad = 0) {
  return d.x >= r.x - pad && d.x <= r.x + r.w + pad && d.y >= r.y - pad && d.y <= r.y + r.h + pad;
}

// What is under (mx, my): { kind: 'minus' | 'plus' | 'row', id } | { kind: 'reset' | 'begin' } | null.
export function hitCreate(mx, my, w, h) {
  const v = view(w, h);
  const d = { x: (mx - v.ox) / v.k, y: (my - v.oy) / v.k };
  const pad = Math.max(0, (MIN_TOUCH * 2 / v.k - BTN.h) / 2); // a finger gets a target of at least 44 px
  if (inside(BEGIN, d)) return { kind: 'begin' };
  if (inside(RESET, d)) return { kind: 'reset' };
  for (let i = 0; i < ATTRS.length; i++) {
    const id = ATTRS[i];
    if (d.y < rowY(i) - pad || d.y > rowY(i) + ROW_H + pad) continue;
    if (inside(btnRect(MINUS_X, i), d, Math.min(pad, 4))) return { kind: 'minus', id };
    if (inside(btnRect(PLUS_X, i), d, Math.min(pad, 4))) return { kind: 'plus', id };
  }
  for (let i = 0; i < ATTRS.length; i++) {
    if (d.x >= ROW_X && d.x <= ROW_X + ROW_W && d.y >= rowY(i) && d.y < rowY(i) + ROW_H) return { kind: 'row', id: ATTRS[i] };
  }
  return null;
}

function button(ctx, r, label, on, accent = '#ffd54f') {
  ctx.fillStyle = on ? 'rgba(255,213,79,0.22)' : 'rgba(255,255,255,0.06)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = on ? accent : '#555';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.fillStyle = on ? accent : '#777';
  ctx.textAlign = 'center';
  ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
}

export function drawCreate(ctx, state, w, h) {
  const draft = state.ui.create;
  if (!draft) return;
  const v = view(w, h);
  const colors = new Map((state.attrDefs ?? []).map((a) => [a.id, a.color]));
  const left = draftLeft(draft);

  ctx.save();
  ctx.fillStyle = '#05050a';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);
  ctx.fillStyle = 'rgba(16,16,28,1)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.strokeStyle = '#3a3a50';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, DW - 2, DH - 2);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(t('create.title'), DW / 2, 30);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#bdbdbd';
  ctx.fillText(t('create.lead'), DW / 2, 56);
  ctx.font = 'bold 15px sans-serif';
  ctx.fillStyle = left > 0 ? '#ffd54f' : '#a5d6a7';
  ctx.fillText(t('create.left', { n: left }), ROW_X + ROW_W / 2, 80);

  ATTRS.forEach((id, i) => {
    const y = rowY(i) + ROW_H / 2;
    if (id === draft.sel) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(ROW_X - 6, rowY(i) + 2, ROW_W + 12, ROW_H - 4);
    }
    ctx.fillStyle = colors.get(id) ?? '#fff';
    ctx.fillRect(ROW_X, y - 6, 12, 12);
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#eee';
    ctx.fillText(t('attr.' + id), ROW_X + 22, y);
    ctx.font = 'bold 20px sans-serif';
    button(ctx, btnRect(MINUS_X, i), '-', canAdjust(draft, id, -1));
    button(ctx, btnRect(PLUS_X, i), '+', canAdjust(draft, id, 1));
    const value = draft.attrs[id];
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = value > BASE ? '#a5d6a7' : value < BASE ? '#ef9a9a' : '#fff';
    ctx.fillText(String(value), VALUE_X, y);
  });

  // what the selected attribute does
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillStyle = colors.get(draft.sel) ?? '#fff';
  ctx.fillText(t('attr.' + draft.sel), SIDE_X, ROW_Y + 14);
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#e0e0e0';
  const lines = wrapText(ctx, t('attr.' + draft.sel + '.desc'), DW - 28 - SIDE_X);
  lines.slice(0, 8).forEach((line, i) => ctx.fillText(line, SIDE_X, ROW_Y + 38 + i * 18));
  ctx.fillStyle = '#9e9e9e';
  wrapText(ctx, t('create.scale'), DW - 28 - SIDE_X).slice(0, 4)
    .forEach((line, i) => ctx.fillText(line, SIDE_X, ROW_Y + 50 + Math.min(lines.length, 8) * 18 + i * 18));

  ctx.textBaseline = 'middle';
  ctx.font = 'bold 16px sans-serif';
  button(ctx, RESET, t('create.reset'), true, '#bdbdbd');
  button(ctx, BEGIN, t('create.begin'), true, '#a5d6a7');
  if (left > 0) {
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#9e9e9e';
    ctx.textAlign = 'right';
    ctx.fillText(t('create.kept'), BEGIN.x + BEGIN.w, BEGIN.y - 12);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
