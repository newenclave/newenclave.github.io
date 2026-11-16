import { t } from '../core/i18n.js';
import { artName } from './chronicle-ui.js';
import { rarityById } from '../sim/loot.js';
import { INV_SIZE, selectedItem } from '../systems/inventory.js';
import { MAX_PLUS, itemPrice, sellPrice, upgradeCost } from '../systems/economy.js';
import { BOAT_PRICE } from '../systems/boat.js';
import { loadoutOf, slotOf, canEquipOffhand, OFFHAND_DAMAGE } from '../systems/loadout.js';
import { MAX_STACK } from '../sim/loot.js';
import { placeFor } from '../systems/equipment.js';
import { isKnown } from '../systems/relics.js';
import { drawItemIcon, placeIcon } from '../render/icons.js';
import { drawSprite, pose } from '../render/sprites.js';

// Laid out in "design" coordinates and scaled to fit any screen (same approach as the skill tree).
// Left: the body (what you wear, and the weapons in your hands) with the six weapon sets below it; at the merchant the
// stock takes its place. Right: the backpack, the details of the selected item and the buttons.
const DW = 760;
const DH = 520;
const CELL = 50;
const STEP = 58;
const COL = { L: 60, C: 150, R: 240 }; // the body's three columns
const ROW = [66, 124, 182, 240];
// where each place sits on the body; 'main' and 'off' are the hands of the active weapon set
const BODY = [
  ['ring1', 'L', 0], ['head', 'C', 0], ['neck', 'R', 0],
  ['wrist1', 'L', 1], ['chest', 'C', 1], ['wrist2', 'R', 1],
  ['hands', 'L', 2], ['legs', 'C', 2], ['ring2', 'R', 2],
  ['main', 'L', 3], ['feet', 'C', 3], ['off', 'R', 3],
];
const BELT = { x: 24, y: 340, cell: 44, step: 50 }; // six sets: the main hand above, the off hand below
const STOCK = { x: 30, y: 66, cols: 5 };
const BOAT_BTN = { x: 30, y: 260, w: 280, h: 40 };
const GRID = { x: 350, y: 66, cols: 5 };
const DETAIL = { x: 350, y: 306, w: 390, h: 150 };
const BTN_ACTION = { x: 350, y: 464, w: 160, h: 40 }; // in shops
const BTN_MAIN = { x: 350, y: 464, w: 120, h: 40 }; // in your own inventory: three buttons in a row
const BTN_OFFHAND = { x: 476, y: 464, w: 120, h: 40 };
const BTN_DROP = { x: 602, y: 464, w: 80, h: 40 };
const CLOSE = { x: DW - 34, y: 26, r: 16 };
const TITLE_H = 46; // the title bar
const BRONZE = '#8a6d3b';
const BRONZE_DARK = '#3d3020';
const MIN_TOUCH_R = 22;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const modeOf = (state) => state.ui.mode ?? 'inventory';

// Every clickable thing in the window, in design coordinates.
function regions(state) {
  const list = [];
  const mode = modeOf(state);
  if (mode === 'merchant') {
    const n = state.shop?.stock.length ?? 0;
    for (let i = 0; i < n; i++) {
      list.push({ kind: 'stock', index: i, x: STOCK.x + (i % STOCK.cols) * STEP, y: STOCK.y + Math.floor(i / STOCK.cols) * STEP, w: CELL, h: CELL });
    }
    list.push({ kind: 'boat', index: 0, ...BOAT_BTN });
  } else {
    const active = Math.max(0, slotOf(state));
    for (const [place, col, row] of BODY) {
      const r = { x: COL[col], y: ROW[row], w: CELL, h: CELL, place };
      if (place === 'main') list.push({ ...r, kind: 'hot', index: active });
      else if (place === 'off') list.push({ ...r, kind: 'off', index: active });
      else list.push({ ...r, kind: 'eq', slot: place });
    }
    for (let i = 0; i < state.weapons.length; i++) {
      const x = BELT.x + i * BELT.step;
      list.push({ kind: 'hot', index: i, belt: true, x, y: BELT.y, w: BELT.cell, h: BELT.cell });
      list.push({ kind: 'off', index: i, belt: true, x, y: BELT.y + BELT.cell + 4, w: BELT.cell, h: BELT.cell });
    }
  }
  for (let i = 0; i < INV_SIZE; i++) {
    list.push({ kind: 'inv', index: i, x: GRID.x + (i % GRID.cols) * STEP, y: GRID.y + Math.floor(i / GRID.cols) * STEP, w: CELL, h: CELL });
  }
  list.push({ kind: 'action', index: 0, ...(mode === 'inventory' ? BTN_MAIN : BTN_ACTION) });
  if (mode === 'inventory') {
    list.push({ kind: 'offaction', index: 0, ...BTN_OFFHAND });
    list.push({ kind: 'drop', index: 0, ...BTN_DROP });
  }
  return list;
}

export function hitInventory(state, mx, my, w, h) {
  const v = view(w, h);
  const cx = v.ox + CLOSE.x * v.k;
  const cy = v.oy + CLOSE.y * v.k;
  if (Math.hypot(mx - cx, my - cy) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  return regions(state).find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
}

// Where a region is on the screen (for tests and for touch helpers): its centre in screen pixels.
export function regionCentre(state, match, w, h) {
  const v = view(w, h);
  const r = regions(state).find((q) => Object.entries(match).every(([k, val]) => q[k] === val));
  return r ? { x: v.ox + (r.x + r.w / 2) * v.k, y: v.oy + (r.y + r.h / 2) * v.k } : null;
}

export function formatBonus(item) {
  return item.kind === 'pct' ? `+${Math.round(item.value * 100)}%` : `+${item.value}`;
}

export const itemName = (item) => (item.art ? artName(item.art) : item.relic ? t('relic.' + item.id) : t(`${item.slot}.${item.id}`))
  + (item.plus > 0 ? ` +${item.plus}` : '') + (item.slot === 'ammo' ? ` x${item.count}` : '');

function valueText(item) {
  if (item.slot === 'relic') return '?'; // a curio: worth its story
  if (item.slot === 'ammo') return `x${item.count}`;
  if (item.slot === 'weapon') return String(item.damage);
  if (item.slot === 'armor') return String(item.defense);
  return formatBonus(item);
}

const tagOf = (item) => t('inv.tag.' + (item.relic && item.slot === 'relic' ? 'relic' : item.slot === 'armor' ? item.part : item.slot === 'accessory' ? item.wear : item.slot));

const delta = (d, digits = 0, suffix = '') => (d
  ? { text: ` (${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(digits)}${suffix})`, up: d > 0 }
  : null);

const effectWords = (fx) => ({
  pct: Math.round((fx.dot?.share ?? 0) * 100),
  s: fx.dot?.time ?? fx.slow?.time ?? 0,
  slow: Math.round((1 - (fx.slow?.mult ?? 1)) * 100),
  n: (fx.pierce ?? 0) + 1,
  r: fx.blast?.radius ?? 0,
  blast: Math.round((fx.blast?.share ?? 0) * 100),
});

// What an item would replace if you put it on (null if it is worn already, or would go to a free place).
function wouldReplace(state, item) {
  const eq = state.player.equipment;
  if (Object.values(eq).includes(item)) return null;
  const place = placeFor(eq, item);
  return place ? eq[place] : null;
}

// Stat lines of an item, with a comparison against what it would replace.
export function itemLines(state, item) {
  const p = state.player;
  const out = [];
  const add = (text, d = null) => out.push({ text, delta: d || null });

  if (item.slot === 'relic') { // a curio: what people think it is, or what it really was
    add(t(isKnown(state, item.id) ? `relic.${item.id}.truth` : `relic.${item.id}.local`));
    if (!isKnown(state, item.id)) add(t('relic.unknown'));
    return out;
  }
  if (item.slot === 'ammo') {
    const fx = state.ammoEffects?.[item.effect];
    add(fx ? t('ammo.effect.' + item.effect, effectWords(fx)) : t('ammo.effect.none'));
    add(t('inv.line.ammoCount', { n: item.count, max: MAX_STACK }));
    add(t('ammo.kind.' + item.kind));
  } else if (item.slot === 'weapon') {
    const cur = item === p.weapon ? null : p.weapon;
    const dps = item.damage / item.cooldown;
    add(t('inv.line.damage', { v: item.damage }), cur && delta(item.damage - cur.damage));
    add(t('inv.line.dps', { v: dps.toFixed(1) }), cur && delta(dps - cur.damage / cur.cooldown, 1));
    add(t('inv.line.range', { v: item.range }));
    add(`${t('wtype.' + item.type)}  -  ${t('wreach.' + (item.reach ?? 'ground'))}  -  ${t('wgrip.' + (item.grip ?? 'one'))}`);
  } else if (item.slot === 'armor') {
    const worn = Object.values(p.equipment).includes(item);
    const cur = worn ? null : p.equipment[item.part];
    add(`${t('eq.' + item.part)}  -  ${t('inv.line.defense', { v: item.defense })}`, !worn && delta(item.defense - (cur ? cur.defense : 0)));
    if (cur) add(t('inv.line.replaces', { name: itemName(cur) }));
  } else {
    const cur = wouldReplace(state, item);
    const same = cur && cur.stat === item.stat;
    const scale = item.kind === 'pct' ? 100 : 1;
    add(
      t('inv.line.bonus', { stat: t('stat.' + item.stat), v: formatBonus(item) }),
      same && delta((item.value - cur.value) * scale, item.kind === 'pct' ? 0 : 1, item.kind === 'pct' ? '%' : ''),
    );
    if (cur && !same) add(t('inv.line.replaces', { name: itemName(cur) }));
  }
  if (item.art) add(t('art.lore', { owner: item.art.owner, town: t('town.name.' + item.art.town), year: item.art.year })); // its story
  if (item.relic) { // a worn relic: what it does beyond its numbers, and what it is
    if (item.effect) add(t('relic.effect.' + item.effect));
    add(t(isKnown(state, item.id) ? `relic.${item.id}.truth` : `relic.${item.id}.local`));
  }
  return out;
}

// The main button for the current selection: { label, enabled, canDrop } or null when there is nothing to do.
function actionFor(state) {
  const sel = state.ui.selected;
  const item = selectedItem(state);
  const mode = modeOf(state);
  const gold = state.player.gold;
  if (!sel || !item) return null;

  if (mode === 'merchant') {
    if (sel.kind === 'stock') {
      const price = itemPrice(item);
      return { label: t('shop.buy', { price }), enabled: gold >= price, canDrop: false };
    }
    if (sel.kind === 'inv') return { label: t('shop.sell', { price: sellPrice(item) }), enabled: true, canDrop: false };
    return null;
  }
  if (mode === 'blacksmith') {
    if (item.slot === 'ammo') return { label: t('shop.cantUpgrade'), enabled: false, canDrop: false };
    if ((item.plus | 0) >= MAX_PLUS) return { label: t('shop.maxed'), enabled: false, canDrop: false };
    const cost = upgradeCost(item);
    return { label: t('shop.upgrade', { cost }), enabled: gold >= cost, canDrop: false };
  }
  if (sel.kind === 'inv') {
    const offLabel = canEquipOffhand(item) ? t(item.slot === 'ammo' ? 'inv.equipAmmo' : 'inv.equipOff') : null;
    if (item.slot === 'ammo') return { label: null, offLabel, enabled: true, canDrop: true }; // ammo has no main-hand use
    const label = item.slot === 'weapon' ? t('inv.equipMain') : t('inv.equip');
    return { label, offLabel, enabled: true, canDrop: true };
  }
  if (sel.kind === 'eq' || sel.kind === 'off') return { label: t('inv.unequip'), enabled: true, canDrop: false };
  return null;
}

function priceLine(state, item) {
  const mode = modeOf(state);
  const sel = state.ui.selected;
  if (mode === 'merchant') {
    return sel?.kind === 'stock' ? t('shop.price', { n: itemPrice(item) }) : t('shop.sellsFor', { n: sellPrice(item) });
  }
  if (mode === 'blacksmith') return t('shop.level', { n: item.plus | 0, max: MAX_PLUS });
  return null;
}

// A recessed slot: dark inside, in shadow along the top and left, catching light along the bottom and right; an item
// shows its picture on a glow of its rarity, with its strength in the corner. An empty place on the body shows a dim
// shape of what goes there.
function drawCell(ctx, r, item, { selected, active, idle, label, small, place }) {
  const rar = item ? rarityById(item.rarity).color : null;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  ctx.fillStyle = selected ? '#2a2a42' : '#12121b';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (item) { // a glow of its rarity, brighter in the middle
    ctx.fillStyle = rar;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(r.x, r.y, r.w, 3);
  ctx.fillRect(r.x, r.y, 3, r.h);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(r.x, r.y + r.h - 2, r.w, 2);
  ctx.fillRect(r.x + r.w - 2, r.y, 2, r.h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = item ? rar : '#2c2a36';
  ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  if (active) {
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  }
  if (idle && item) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#e57373';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    ctx.setLineDash([]);
  }
  if (selected) {
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  }
  ctx.textAlign = 'center';
  if (!item) {
    const shape = place && placeIcon(place);
    if (shape) drawSprite(ctx, shape, cx, cy, { scale: 2, flash: '#262433', slots: { O: '#1b1a26' } });
    else if (label) {
      ctx.fillStyle = '#4c4a5c';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(label, cx, cy + 5, r.w - 4);
    }
    return;
  }
  drawItemIcon(ctx, item, cx, cy - 3, { scale: 2 });
  const corner = (text, x, y, color, align) => {
    ctx.textAlign = align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0b0b12';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  ctx.font = 'bold 10px sans-serif';
  if (item.art) corner('★', r.x + 5, r.y + 12, '#ff9800', 'left');
  else if (item.relic) corner('◆', r.x + 5, r.y + 12, '#80deea', 'left');
  if (item.plus > 0) corner(`+${item.plus}`, r.x + r.w - 4, r.y + 12, '#ffd54f', 'right');
  ctx.font = small ? 'bold 10px sans-serif' : 'bold 11px sans-serif';
  corner(valueText(item), r.x + r.w - 4, r.y + r.h - 4, '#fff', 'right');
  ctx.textAlign = 'center';
}

// A raised button: light along its top, shadow along its bottom.
function drawButton(ctx, b, label, enabled) {
  ctx.fillStyle = enabled ? '#3d6a3a' : '#26252c';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = enabled ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)';
  ctx.fillRect(b.x, b.y, b.w, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(b.x, b.y + b.h - 4, b.w, 4);
  ctx.strokeStyle = enabled ? '#8bc34a' : '#45434f';
  ctx.lineWidth = 2;
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = enabled ? '#fff' : '#777';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 5, b.w - 8);
}

// The hero, big and faint, behind the places on the body, so the layout reads as a person at a glance.
function drawFigure(ctx) {
  ctx.fillStyle = 'rgba(255,255,255,0.03)'; // a recessed panel for the body
  ctx.fillRect(COL.L - 16, ROW[0] - 12, COL.R - COL.L + CELL + 32, ROW[3] - ROW[0] + CELL + 24);
  ctx.globalAlpha = 0.13;
  drawSprite(ctx, pose('hero', 0, 1).name, COL.C + CELL / 2, (ROW[0] + ROW[3] + CELL) / 2, { scale: 13 });
  ctx.globalAlpha = 1;
}

// The window: a dark panel in a bronze frame with rivets in the corners, and a title bar.
function drawFrame(ctx) {
  ctx.fillStyle = 'rgba(14,13,21,0.97)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.fillStyle = 'rgba(255,255,255,0.02)'; // a little lighter towards the top
  ctx.fillRect(0, 0, DW, DH / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, DW, TITLE_H);
  ctx.fillStyle = BRONZE_DARK;
  ctx.fillRect(0, TITLE_H, DW, 2);
  ctx.fillStyle = BRONZE;
  ctx.fillRect(0, TITLE_H - 1, DW, 1);
  ctx.lineWidth = 3;
  ctx.strokeStyle = BRONZE_DARK;
  ctx.strokeRect(1.5, 1.5, DW - 3, DH - 3);
  ctx.lineWidth = 1;
  ctx.strokeStyle = BRONZE;
  ctx.strokeRect(4.5, 4.5, DW - 9, DH - 9);
  for (const [x, y] of [[8, 8], [DW - 14, 8], [8, DH - 14], [DW - 14, DH - 14]]) {
    ctx.fillStyle = BRONZE;
    ctx.fillRect(x, y, 6, 6);
    ctx.fillStyle = '#d8b878';
    ctx.fillRect(x, y, 3, 3);
  }
}

export function drawInventory(ctx, state, w, h) {
  const v = view(w, h);
  const p = state.player;
  const sel = state.ui.selected;
  const mode = modeOf(state);

  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);

  drawFrame(ctx);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f3e3c0';
  ctx.font = 'bold 20px serif';
  ctx.fillText(t(mode === 'inventory' ? 'inv.title' : 'shop.title.' + mode), DW / 2, 31);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(t('hud.gold', { n: p.gold }), 24, 30);

  ctx.fillStyle = '#2a2230'; // the close button
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BRONZE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#d8c8a8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CLOSE.x - 6, CLOSE.y - 6); ctx.lineTo(CLOSE.x + 6, CLOSE.y + 6);
  ctx.moveTo(CLOSE.x + 6, CLOSE.y - 6); ctx.lineTo(CLOSE.x - 6, CLOSE.y + 6);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#bbb';
  ctx.font = '13px sans-serif';
  ctx.fillText(t('inv.bag'), GRID.x, GRID.y - 10);
  if (mode === 'merchant') {
    ctx.fillText(t('shop.stock'), STOCK.x, STOCK.y - 10);
    drawButton(ctx, BOAT_BTN, p.boat ? t('shop.boat.owned') : t('shop.boat', { price: BOAT_PRICE }), !p.boat && p.gold >= BOAT_PRICE);
  } else {
    drawFigure(ctx);
    ctx.fillStyle = '#bbb';
    ctx.font = '13px sans-serif';
    ctx.fillText(t('inv.belt'), BELT.x, BELT.y - 10);
    const def = p.stats?.defense ?? 0;
    ctx.fillStyle = '#90caf9';
    ctx.fillText(t('inv.defense.total', { v: def, pct: Math.round((100 * def) / (50 + def)) }), COL.L - 30, ROW[3] + CELL + 22);
  }

  for (const r of regions(state)) {
    if (['action', 'offaction', 'drop', 'boat'].includes(r.kind)) continue;
    let item;
    if (r.kind === 'hot') item = state.weapons[r.index];
    else if (r.kind === 'inv') item = state.inventory[r.index];
    else if (r.kind === 'stock') item = state.shop?.stock[r.index] ?? null;
    else if (r.kind === 'off') item = state.offhands?.[r.index] ?? null;
    else item = p.equipment[r.slot];
    const isSel = sel?.kind === r.kind && (r.kind === 'eq' ? sel.slot === r.slot : sel.index === r.index);
    drawCell(ctx, r, item, {
      selected: isSel && (r.belt || r.kind === 'eq' || r.kind === 'inv' || r.kind === 'stock'),
      active: r.belt && r.kind === 'hot' && item === p.weapon,
      idle: r.kind === 'off' && loadoutOf(state, r.index).mode === 'idle',
      label: r.place ? t('eq.' + r.place) : r.belt && r.kind === 'hot' ? String(r.index + 1) : null,
      place: r.place ?? (r.belt ? (r.kind === 'hot' ? null : 'off') : null),
      small: r.belt,
    });
    if (r.belt && r.kind === 'hot') { // the number key of the set
      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(r.index + 1), r.x + 3, r.y + r.h - 4);
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h);
  ctx.strokeStyle = BRONZE_DARK;
  ctx.lineWidth = 2;
  ctx.strokeRect(DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h);
  const item = selectedItem(state);
  ctx.textAlign = 'left';
  if (item) {
    const pic = { x: DETAIL.x + 10, y: DETAIL.y + 10, w: 68, h: 68 };
    drawCell(ctx, pic, null, {});
    const rar = rarityById(item.rarity).color;
    ctx.fillStyle = rar;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(pic.x + 4, pic.y + 4, pic.w - 8, pic.h - 8);
    ctx.globalAlpha = 0.14;
    ctx.fillRect(pic.x + 16, pic.y + 16, pic.w - 32, pic.h - 32);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rar;
    ctx.strokeRect(pic.x - 1, pic.y - 1, pic.w + 2, pic.h + 2);
    drawItemIcon(ctx, item, pic.x + 34, pic.y + 34, { scale: 3 });
    ctx.textAlign = 'left'; // drawCell leaves it centred
    const tx = DETAIL.x + 90;
    const tw = DETAIL.w - 102;
    ctx.fillStyle = rar;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${t('rarity.' + item.rarity)} ${itemName(item)}`, tx, DETAIL.y + 26, tw);
    ctx.font = '13px sans-serif';
    itemLines(state, item).slice(0, 5).forEach((l, i) => {
      const y = DETAIL.y + 48 + i * 19;
      ctx.fillStyle = '#eee';
      ctx.fillText(l.text, tx, y, tw);
      if (l.delta) {
        ctx.fillStyle = l.delta.up ? '#81c784' : '#e57373';
        ctx.fillText(l.delta.text, tx + Math.min(tw - 70, ctx.measureText(l.text).width), y);
      }
    });
  } else {
    ctx.fillStyle = '#888';
    ctx.font = '13px sans-serif';
    ctx.fillText(t(mode === 'inventory' ? 'inv.hint' : 'inv.hint.' + mode), DETAIL.x + 12, DETAIL.y + 30, DETAIL.w - 24);
  }
  if (item && mode !== 'inventory') {
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(priceLine(state, item), DETAIL.x + DETAIL.w - 12, DETAIL.y + DETAIL.h - 12);
    ctx.textAlign = 'left';
  }
  if (mode === 'merchant' && state.ui.sellArmed !== null && state.ui.sellArmed !== undefined) {
    const armed = state.inventory[state.ui.sellArmed];
    if (armed) {
      ctx.fillStyle = '#ffab91';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(t('shop.sellArmed', { name: itemName(armed), price: sellPrice(armed) }), DETAIL.x + 12, DETAIL.y + DETAIL.h - 12, DETAIL.w - 24);
    }
  }
  if (sel?.kind === 'off') { // why the off hand is doing nothing
    const lo = loadoutOf(state, sel.index);
    ctx.fillStyle = lo.mode === 'idle' ? '#ef9a9a' : '#a5d6a7';
    ctx.font = '13px sans-serif';
    const note = lo.mode === 'idle' ? t('inv.idle.' + lo.reason) : t(lo.mode === 'dual' ? 'inv.active.dual' : 'inv.active.ammo', { pct: Math.round(OFFHAND_DAMAGE * 100) });
    if (lo.off) ctx.fillText(note, DETAIL.x + 12, DETAIL.y + DETAIL.h - 12, DETAIL.w - 24);
  }
  const action = actionFor(state);
  if (action?.label) drawButton(ctx, mode === 'inventory' ? BTN_MAIN : BTN_ACTION, action.label, action.enabled);
  if (action?.offLabel) drawButton(ctx, BTN_OFFHAND, action.offLabel, true);
  if (action?.canDrop) drawButton(ctx, BTN_DROP, t('inv.drop'), true);

  ctx.restore();
  ctx.textAlign = 'left';
}
