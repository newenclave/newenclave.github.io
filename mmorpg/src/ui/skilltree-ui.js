import { t } from '../core/i18n.js';
import { canRank, rankOf, missingRequirements } from '../systems/skilltree.js';

// The tree is laid out in "design" coordinates and scaled to fit any screen.
const CELL_X = 96;
const CELL_Y = 110;
const NODE_R = 30;
const PAD_X = 80;
const TOP = 100;
const DW = 8 * CELL_X + 2 * PAD_X;
const DH = 3 * CELL_Y + 190;
const CLOSE = { x: DW - 34, y: 34, r: 20 };
const MIN_TOUCH_R = 22;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

function toScreen(v, x, y) {
  return { x: v.ox + x * v.k, y: v.oy + y * v.k };
}

const designPos = (node) => ({ x: PAD_X + node.x * CELL_X, y: TOP + node.y * CELL_Y });

export function nodeScreenPos(node, w, h) {
  const d = designPos(node);
  return toScreen(view(w, h), d.x, d.y);
}

export function hitTest(state, mx, my, w, h) {
  const v = view(w, h);
  const r = Math.max(NODE_R * v.k, MIN_TOUCH_R);
  for (const node of state.skills) {
    const pos = nodeScreenPos(node, w, h);
    if (Math.hypot(mx - pos.x, my - pos.y) <= r) return node;
  }
  return null;
}

export function hitClose(mx, my, w, h) {
  const v = view(w, h);
  const pos = toScreen(v, CLOSE.x, CLOSE.y);
  return Math.hypot(mx - pos.x, my - pos.y) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R);
}

export function formatEffect(effect) {
  return effect.kind === 'pct' ? `${Math.round(effect.value * 100)}%` : String(effect.value);
}

export function drawSkillTree(ctx, state, w, h) {
  const p = state.player;
  const v = view(w, h);
  const branchColor = new Map(state.skillBranches.map((b) => [b.id, b.color]));
  const touchMode = state.touch.recent(5000);
  let focus = null;
  if (touchMode) {
    focus = state.skillIndex.get(state.ui.selectedSkill) ?? null;
  } else {
    focus = hitTest(state, state.mouse.x, state.mouse.y, w, h);
  }

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);

  ctx.fillStyle = 'rgba(10,10,20,0.92)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(t('skills.title', { points: p.skillPoints }), DW / 2, 38);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  ctx.font = 'bold 16px sans-serif';
  for (const b of state.skillBranches) {
    ctx.fillStyle = b.color;
    ctx.fillText(t('branch.' + b.id), PAD_X + b.x * CELL_X, 68);
  }

  for (const node of state.skills) {
    const a = designPos(node);
    for (const reqId of node.requires) {
      const b = designPos(state.skillIndex.get(reqId));
      ctx.strokeStyle = rankOf(p, reqId) > 0 ? branchColor.get(node.branch) : '#444';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  for (const node of state.skills) {
    const pos = designPos(node);
    const color = branchColor.get(node.branch);
    const rank = rankOf(p, node.id);
    const available = canRank(p, node);
    const unlocked = missingRequirements(p, node).length === 0;

    ctx.globalAlpha = unlocked ? 1 : 0.4;
    ctx.fillStyle = rank > 0 ? color : '#222';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, NODE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = available ? 4 : 2;
    ctx.strokeStyle = available ? '#fff' : color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (node === focus) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, NODE_R + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = rank > 0 ? '#111' : '#ddd';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`${rank}/${node.maxRank}`, pos.x, pos.y + 5);
    ctx.fillStyle = '#ccc';
    ctx.font = '12px sans-serif';
    ctx.fillText(t('skill.' + node.id + '.name'), pos.x, pos.y + NODE_R + 16);
  }
  ctx.restore();

  if (focus) {
    const anchor = touchMode ? nodeScreenPos(focus, w, h) : state.mouse;
    drawTooltip(ctx, state, focus, anchor, w, h, touchMode);
  }
  ctx.textAlign = 'left';
}

function drawTooltip(ctx, state, node, anchor, w, h, touchMode) {
  const p = state.player;
  const lines = [
    t('skill.' + node.id + '.name'),
    t('skill.' + node.id + '.desc', { value: formatEffect(node.effects[0]) }),
    t('skills.rank', { rank: rankOf(p, node.id), max: node.maxRank }),
  ];
  const missing = missingRequirements(p, node);
  if (missing.length) {
    lines.push(t('skills.requires', { names: missing.map((id) => t('skill.' + id + '.name')).join(', ') }));
  } else if (canRank(p, node)) {
    lines.push(t(touchMode ? 'skills.tap' : 'skills.click'));
  }
  ctx.font = '14px sans-serif';
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  const height = lines.length * 20 + 12;
  const x = Math.max(6, Math.min(anchor.x + 16, w - width - 6));
  const y = Math.max(6, Math.min(anchor.y + 16, h - height - 6));
  ctx.fillStyle = 'rgba(0,0,0,0.94)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.textAlign = 'left';
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? '#ffd54f' : i === 3 ? '#ff8a80' : '#eee';
    ctx.fillText(l, x + 10, y + 22 + i * 20);
  });
}
