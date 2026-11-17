// The test arena's panel (systems/arena.js): buttons on the left, under the HUD. Mouse and touch both press them.
import { t } from '../core/i18n.js';
import { arenaRoster } from '../systems/arena.js';
import { rarityById } from '../sim/loot.js';

const X = 10;
export const ARENA_TOP = 190; // below the HUD: health, mana, level, gold and points
const TOP = ARENA_TOP;
const W = 260;
const ROW = 30;
const GAP = 4;

// [id, row, column, columns in that row]
const BUTTONS = [
  ['prev', 0, 0, 0], ['next', 0, 2, 0], // around the name of the monster
  ['one', 1, 0, 2], ['pack', 1, 1, 2],
  ['tier', 2, 0, 2], ['rarity', 2, 1, 2],
  ['god', 3, 0, 2], ['heal', 3, 1, 2],
  ['clear', 4, 0, 2], ['meter', 4, 1, 2],
  ['reqs', 5, 0, 1],
];
const ARROW = 34;
const ROWS = 6;

export function layoutArena() {
  return BUTTONS.map(([id, row, col, cols]) => {
    const y = TOP + row * (ROW + GAP);
    if (!cols) return { id, x: col === 0 ? X : X + W - ARROW, y, w: ARROW, h: ROW };
    const bw = (W - GAP * (cols - 1)) / cols;
    return { id, x: X + col * (bw + GAP), y, w: bw, h: ROW };
  });
}

export const arenaPanelBottom = () => TOP + ROWS * (ROW + GAP) + 92;
export const overArenaPanel = (x, y) => x >= X && x <= X + W && y >= TOP && y <= arenaPanelBottom();
export const hitArena = (x, y) => layoutArena().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id ?? null;

const monsterName = (id) => (id.startsWith('boss:') ? `${t('bestiary.name.' + id.slice(5))} (${t('arena.boss')})` : t('bestiary.name.' + id));

function label(state, id) {
  const a = state.arena;
  switch (id) {
    case 'prev': return '<';
    case 'next': return '>';
    case 'tier': return t('arena.tier', { n: a.tier });
    case 'rarity': return t('rarity.' + a.rarity);
    case 'god': return t('arena.god', { state: t(a.god ? 'menu.on' : 'menu.off') });
    case 'reqs': return t('arena.reqs', { state: t(state.ignoreReqs ? 'menu.off' : 'menu.on') });
    default: return t('arena.' + id);
  }
}

export function drawArenaPanel(ctx, state) {
  const a = state.arena;
  if (!a) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(X - 4, TOP - 4, W + 8, arenaPanelBottom() - TOP + 8);
  ctx.font = '13px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.fillText(monsterName(arenaRoster(state)[a.sel]), X + W / 2, TOP + ROW / 2);
  for (const b of layoutArena()) {
    const on = (b.id === 'god' && a.god) || (b.id === 'reqs' && !state.ignoreReqs);
    ctx.fillStyle = on ? 'rgba(255,193,7,0.45)' : 'rgba(255,255,255,0.14)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    ctx.fillStyle = b.id === 'rarity' ? rarityById(a.rarity).color : '#fff';
    ctx.fillText(label(state, b.id), b.x + b.w / 2, b.y + b.h / 2);
  }
  // the meter: what you dealt and took since the last reset, and how fast
  const m = state.meter;
  const y = TOP + ROWS * (ROW + GAP) + 8;
  ctx.textAlign = 'left';
  ctx.font = '12px monospace';
  ctx.fillStyle = '#e0e0e0';
  const dps = m.t > 0 ? m.dealt / m.t : 0;
  const lines = [
    t('arena.meter.dealt', { n: Math.round(m.dealt), dps: dps.toFixed(1) }),
    t('arena.meter.taken', { n: Math.round(m.taken), dps: (m.t > 0 ? m.taken / m.t : 0).toFixed(1) }),
    t('arena.meter.kills', { n: m.kills, time: m.t.toFixed(1) }),
    t('arena.keys.0'),
    t('arena.keys.1'),
  ];
  lines.forEach((s, i) => {
    ctx.fillStyle = i >= 3 ? '#9e9e9e' : '#e0e0e0';
    ctx.fillText(s, X, y + i * 18);
  });
  ctx.restore();
}
