import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { menuItems } from '../systems/menu.js';

const TITLE_KEYS = {
  main: 'menu.title', pause: 'menu.paused', settings: 'menu.settings', controls: 'menu.controls', confirm: 'menu.confirm.title',
};
const CONTROL_LINES = [1, 2, 3, 4, 5, 6, 7].map((n) => `menu.controls.l${n}`);
const GAP = 10;

export const menuContext = (app) => ({ hasSave: app.saveInfo !== null, settings: app.settings });

// Buttons are stacked in the middle; sizes adapt, so the menu also fits a phone held sideways.
export function layoutMenu(app, w, h) {
  const items = menuItems(app.menu, menuContext(app));
  const compact = h < 450;
  const titleBlock = compact ? 64 : 140;
  const textBlock = {
    controls: compact ? 150 : 230, confirm: compact ? 50 : 90, main: compact ? 24 : 36,
  }[app.menu.screen] ?? 0;
  const avail = h - titleBlock - textBlock - 24;
  const n = Math.max(1, items.length);
  const bh = Math.max(34, Math.min(52, (avail - GAP * (n - 1)) / n));
  const total = n * bh + (n - 1) * GAP;
  const bw = Math.min(340, w - 40);
  const top = titleBlock + textBlock + Math.max(0, (avail - total) / 2);
  const rects = items.map((item, index) => ({ item, index, x: (w - bw) / 2, y: top + index * (bh + GAP), w: bw, h: bh }));
  return { items, rects, compact, titleBlock };
}

export function hitMenu(rects, mx, my) {
  return rects.findIndex((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h);
}

function formatDate(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

export function saveSummary(info) {
  const base = t('menu.save.summary', { level: info.level, gold: info.gold, quests: info.quests });
  return info.savedAt ? `${base}  -  ${formatDate(info.savedAt)}` : base;
}

export function drawMenuBackground(ctx, w, h, time) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d1220');
  g.addColorStop(1, '#1c2a3d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) { // soft drifting lights
    const x = w * (0.1 + 0.8 * ((i * 0.37 + Math.sin(time / 6000 + i) * 0.05) % 1));
    const y = h * (0.15 + 0.7 * ((i * 0.53) % 1)) + Math.sin(time / 3000 + i * 2) * 12;
    ctx.fillStyle = `rgba(120,160,255,${0.04 + 0.02 * Math.sin(time / 2000 + i)})`;
    ctx.beginPath();
    ctx.arc(x, y, 60 + i * 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMenu(ctx, app, w, h) {
  const { items, rects, compact } = layoutMenu(app, w, h);
  const menu = app.menu;
  const screen = menu.screen;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd54f';
  ctx.font = `bold ${compact ? 30 : 52}px sans-serif`;
  ctx.fillText(t(TITLE_KEYS[screen]), w / 2, compact ? 44 : 92);
  if (screen === 'main' && !compact) {
    ctx.fillStyle = '#9fb3d9';
    ctx.font = '16px sans-serif';
    ctx.fillText(t('menu.subtitle'), w / 2, 122);
  }

  const textTop = (compact ? 64 : 140) + 6;
  if (screen === 'main' && app.saveInfo) {
    ctx.fillStyle = '#b0bfd9';
    ctx.font = `${compact ? 12 : 14}px sans-serif`;
    ctx.fillText(saveSummary(app.saveInfo), w / 2, textTop + 12);
  } else if (screen === 'controls') {
    ctx.fillStyle = '#e0e6f2';
    ctx.font = `${compact ? 13 : 16}px sans-serif`;
    CONTROL_LINES.forEach((key, i) => ctx.fillText(t(key), w / 2, textTop + 16 + i * (compact ? 18 : 28)));
  } else if (screen === 'confirm') {
    ctx.fillStyle = '#e0e6f2';
    ctx.font = `${compact ? 13 : 16}px sans-serif`;
    wrapText(ctx, t(menu.confirm.textKey), Math.min(w - 40, 460)).forEach((line, i) => {
      ctx.fillText(line, w / 2, textTop + 16 + i * (compact ? 18 : 24));
    });
  }

  ctx.font = `bold ${compact ? 14 : 17}px sans-serif`;
  for (const r of rects) {
    const { item } = r;
    const disabled = item.enabled === false;
    const active = r.index === menu.cursor && !disabled;
    ctx.fillStyle = disabled ? '#1b2030' : active ? '#3d4b73' : '#2b3347';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = disabled ? '#2f364a' : active ? '#ffd54f' : '#58648a';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    const args = {};
    for (const [name, key] of Object.entries(item.argKeys ?? {})) args[name] = t(key);
    ctx.fillStyle = disabled ? '#667088' : item.danger ? '#ff9e94' : '#fff';
    ctx.fillText(t(item.key, args), w / 2, r.y + r.h / 2 + (compact ? 5 : 6));
  }
  if (items.length === 0) ctx.fillText('', w / 2, h / 2);

  if (app.notice) {
    ctx.globalAlpha = Math.max(0, Math.min(1, app.notice.left / 0.5));
    ctx.fillStyle = '#ffd54f';
    ctx.font = `bold ${compact ? 14 : 16}px sans-serif`;
    ctx.fillText(app.notice.text, w / 2, h - (compact ? 14 : 26));
    ctx.globalAlpha = 1;
  }
  if (!compact && !app.touchUi) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px sans-serif';
    ctx.fillText(t('menu.hint'), w / 2, h - 50);
  }
  ctx.textAlign = 'left';
}
