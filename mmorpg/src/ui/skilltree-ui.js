// The skill web screen (key K): drag it around, zoom with the wheel, two fingers or the + and - buttons. Pointing at a
// skill (or tapping it on a phone) shows what it does and lights the way to it; a click learns the whole way, if the
// points are there. In the test arena a right click (a long press) gives a skill back.
import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { isLearned, canLearn, pathTo } from '../systems/skilltree.js';
import { ATTRS } from '../systems/attributes.js';

export const RING = 64; // web units between two rings
const NODE_R = { start: 14, entry: 13, small: 9, notable: 15, keystone: 19 };
const MIN_TOUCH_R = 20;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 2.2;
const BTN_R = 20;
const JUNCTION = '#ffcc80';

// Where a skill sits on the web, in web units, around the start at (0, 0).
export function nodePos(node) {
  const a = (node.angle * Math.PI) / 180;
  return { x: Math.cos(a) * node.ring * RING, y: Math.sin(a) * node.ring * RING };
}

// The view of the web: its centre (web units) and zoom. Starts showing the start and the first rings.
export function webView(state, w, h) {
  const ui = state.ui;
  if (!ui.web) ui.web = { x: 0, y: 0, zoom: fitZoom(w, h), sel: null };
  return ui.web;
}

export const fitZoom = (w, h) => Math.max(ZOOM_MIN, Math.min(1.2, Math.min(w, h) / (2 * 4.6 * RING)));

export const toScreen = (v, w, h, p) => ({ x: w / 2 + (p.x - v.x) * v.zoom, y: h / 2 + (p.y - v.y) * v.zoom });
const toWeb = (v, w, h, x, y) => ({ x: v.x + (x - w / 2) / v.zoom, y: v.y + (y - h / 2) / v.zoom });

// Zoom by `k` keeping the point under (sx, sy) where it is.
export function zoomAt(v, w, h, k, sx = w / 2, sy = h / 2) {
  const before = toWeb(v, w, h, sx, sy);
  v.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * k));
  const after = toWeb(v, w, h, sx, sy);
  v.x += before.x - after.x;
  v.y += before.y - after.y;
}

export function panBy(v, dx, dy) {
  v.x -= dx / v.zoom;
  v.y -= dy / v.zoom;
  const lim = 9 * RING; // not off into nothing
  v.x = Math.max(-lim, Math.min(lim, v.x));
  v.y = Math.max(-lim, Math.min(lim, v.y));
}

export function webButtons(w) {
  return [
    { id: 'close', x: w - 34, y: 34, r: BTN_R },
    { id: 'zoomIn', x: w - 34, y: 84, r: BTN_R },
    { id: 'zoomOut', x: w - 34, y: 130, r: BTN_R },
    { id: 'fit', x: w - 34, y: 176, r: BTN_R },
  ];
}

const nodeR = (node) => NODE_R[node.kind] ?? NODE_R.small;

// What is under (x, y) on the screen: { kind: 'button', id } | { kind: 'node', node } | null.
export function hitWeb(state, x, y, w, h) {
  for (const b of webButtons(w)) if (Math.hypot(x - b.x, y - b.y) <= Math.max(b.r, MIN_TOUCH_R) + 4) return { kind: 'button', id: b.id };
  const v = webView(state, w, h);
  let best = null;
  for (const node of state.web.nodes) {
    const s = toScreen(v, w, h, nodePos(node));
    const d = Math.hypot(x - s.x, y - s.y);
    const r = Math.max(nodeR(node) * v.zoom, MIN_TOUCH_R);
    if (d <= r && (!best || d < best.d)) best = { d, node };
  }
  return best ? { kind: 'node', node: best.node } : null;
}

const sectorColor = (state, sector) => (sector?.includes('+') ? JUNCTION : state.web.sectors.find((s) => s.id === sector)?.color ?? '#eee');

// One effect as text: "+12 Max HP", "+5% Melee damage", "+1 Strength".
export function effectText(e) {
  if (ATTRS.includes(e.stat)) return `+${e.value} ${t('attr.' + e.stat)}`;
  const v = e.kind === 'pct' ? `${Math.round(e.value * 100)}%` : String(e.value);
  return `${e.value >= 0 ? '+' : ''}${v} ${t('stat.' + e.stat)}`;
}

// What the tooltip of a skill says, as [text, colour] lines.
export function nodeLines(state, node, touchMode) {
  const p = state.player;
  const named = node.kind !== 'small';
  const title = node.kind === 'start' ? t('web.startName') : named ? t('web.' + node.id) : t('web.kind.small');
  const lines = [[title, '#ffd54f']];
  if (named && node.kind !== 'start') lines.push([t('web.kind.' + node.kind), '#9e9e9e']);
  for (const g of node.grants ?? []) lines.push([t('grant.' + g), '#90caf9']);
  for (const e of node.effects ?? []) lines.push([effectText(e), '#eee']);
  if (node.rule) lines.push([t('rule.' + node.rule), '#ffab91']);
  if (node.kind === 'start') lines.push([t('web.start'), '#eee']);
  else if (isLearned(p, node.id)) lines.push([t('web.learned'), '#a5d6a7']);
  else {
    const path = pathTo(state, node.id);
    const n = path?.length ?? 0;
    if (n > (p.skillPoints | 0)) lines.push([t('web.short', { n }), '#ef9a9a']);
    else lines.push([t(n > 1 ? 'web.costPath' : 'web.cost', { n }), '#eee'], [t(touchMode ? 'web.tap' : 'web.click'), '#a5d6a7']);
  }
  if (state.arena && isLearned(p, node.id) && node.kind !== 'start') lines.push([t(touchMode ? 'web.forget.touch' : 'web.forget'), '#9e9e9e']);
  return lines;
}

export function drawSkillTree(ctx, state, w, h) {
  const p = state.player;
  const v = webView(state, w, h);
  const touchMode = state.touch.recent(5000);
  const hover = touchMode ? null : hitWeb(state, state.mouse.x, state.mouse.y, w, h);
  const focus = hover?.kind === 'node' ? hover.node : state.web.index.get(v.sel) ?? null;
  const path = new Set(focus ? pathTo(state, focus.id) ?? [] : []);

  ctx.save();
  ctx.fillStyle = 'rgba(8,8,16,0.96)';
  ctx.fillRect(0, 0, w, h);

  // the rings, faintly, and the sector names
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const c = toScreen(v, w, h, { x: 0, y: 0 });
  for (let r = 1; r <= 8; r++) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * RING * v.zoom, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(Math.max(12, 18 * v.zoom))}px sans-serif`;
  for (const s of state.web.sectors) {
    const a = (s.angle * Math.PI) / 180;
    const at = toScreen(v, w, h, { x: Math.cos(a) * 8.4 * RING, y: Math.sin(a) * 8.4 * RING });
    ctx.fillStyle = s.color;
    ctx.fillText(t('branch.' + s.id), at.x, at.y);
  }

  // the links
  for (const [a, b] of state.web.links) {
    const na = state.web.index.get(a);
    const nb = state.web.index.get(b);
    if (!na || !nb) continue;
    const pa = toScreen(v, w, h, nodePos(na));
    const pb = toScreen(v, w, h, nodePos(nb));
    const la = isLearned(p, a);
    const lb = isLearned(p, b);
    const lit = (path.has(a) || la) && (path.has(b) || lb) && (path.has(a) || path.has(b));
    ctx.strokeStyle = lit ? '#ffd54f' : la && lb ? sectorColor(state, nb.sector ?? na.sector) : la || lb ? '#8a8a8a' : '#3a3a46';
    ctx.lineWidth = (la && lb) || lit ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }

  // the skills
  ctx.font = `${Math.round(Math.max(10, 12 * v.zoom))}px sans-serif`;
  for (const node of state.web.nodes) {
    const s = toScreen(v, w, h, nodePos(node));
    const r = nodeR(node) * v.zoom;
    if (s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40) continue;
    const learned = isLearned(p, node.id);
    const color = node.kind === 'start' ? '#fff' : sectorColor(state, node.sector);
    ctx.fillStyle = learned ? color : path.has(node.id) ? 'rgba(255,213,79,0.35)' : '#1c1c28';
    ctx.strokeStyle = canLearn(state, node.id) ? '#fff' : color;
    ctx.lineWidth = canLearn(state, node.id) ? 3 : 2;
    ctx.beginPath();
    if (node.kind === 'keystone') { // a diamond
      ctx.moveTo(s.x, s.y - r * 1.15);
      ctx.lineTo(s.x + r * 1.15, s.y);
      ctx.lineTo(s.x, s.y + r * 1.15);
      ctx.lineTo(s.x - r * 1.15, s.y);
      ctx.closePath();
    } else ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (node.kind === 'notable' || node.kind === 'entry') { // a second ring
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 4 * v.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (node === focus) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (node.kind !== 'small' && node.kind !== 'start' && v.zoom >= 0.6) {
      ctx.fillStyle = learned ? '#fff' : '#bdbdbd';
      ctx.fillText(t('web.' + node.id), s.x, s.y + r + 12 * Math.max(1, v.zoom));
    }
  }

  // the title, the buttons, the hint
  ctx.textAlign = 'center';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = p.skillPoints > 0 ? '#ffd54f' : '#fff';
  ctx.fillText(t('skills.title', { points: p.skillPoints | 0 }), w / 2, 30);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#9e9e9e';
  ctx.fillText(t(touchMode ? 'web.hint.touch' : 'web.hint'), w / 2, h - 16);
  for (const b of webButtons(w)) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#eee';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText({ close: 'x', zoomIn: '+', zoomOut: '-', fit: 'o' }[b.id], b.x, b.y + 1);
  }

  if (focus) {
    const anchor = touchMode ? toScreen(v, w, h, nodePos(focus)) : state.mouse;
    drawTooltip(ctx, nodeLines(state, focus, touchMode), anchor, w, h);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawTooltip(ctx, lines, anchor, w, h) {
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const maxW = Math.min(320, w - 24);
  const rows = lines.flatMap(([text, color]) => wrapText(ctx, text, maxW - 20).map((l) => [l, color]));
  const width = Math.min(maxW, Math.max(...rows.map(([l]) => ctx.measureText(l).width)) + 20);
  const height = rows.length * 19 + 12;
  const x = Math.max(6, Math.min(anchor.x + 18, w - width - 6));
  const y = Math.max(6, Math.min(anchor.y + 18, h - height - 6));
  ctx.fillStyle = 'rgba(0,0,0,0.94)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  rows.forEach(([l, color], i) => {
    ctx.fillStyle = color;
    ctx.fillText(l, x + 10, y + 21 + i * 19);
  });
}
