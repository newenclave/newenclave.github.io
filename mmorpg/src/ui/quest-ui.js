import { t } from '../core/i18n.js';
import { listForGiver } from '../systems/quests.js';
import { itemName } from './inventory-ui.js';
import { wrapText } from '../core/format.js';
import { elderLine } from '../systems/lore.js';
import { eventText } from './chronicle-ui.js';

// Same scaled "design space" approach as the other panels.
const DW = 690;
const DH = 470;
const ROW = { x: 30, y: 84, w: 630, h: 58, gap: 4 };
const BTN = { w: 120, h: 40 };
const CLOSE = { x: DW - 34, y: 34, r: 20 };
const MIN_TOUCH_R = 22;
const MAX_ROWS = 6;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

const rowY = (i) => ROW.y + i * (ROW.h + ROW.gap);
const buttonRect = (i) => ({ x: ROW.x + ROW.w - BTN.w - 12, y: rowY(i) + (ROW.h - BTN.h) / 2, w: BTN.w, h: BTN.h });

export const questRows = (state) => listForGiver(state, state.ui.questTown, state.ui.questNpc ?? 'elder').slice(0, MAX_ROWS);

// Generated quests carry raw arguments (town numbers, enemy ids, names) that are turned into words here.
export function questArgs(def) {
  const a = def.args ?? {};
  const args = { ...(a.words ?? {}) };
  for (const k of ['town', 'city', 'capital']) if (a[k] !== undefined) args[k] = t('town.name.' + a[k]);
  if (a.enemy) args.target = t('enemy.' + a.enemy);
  if (a.dungeon) args.dungeon = t('dungeon.theme.' + a.dungeon);
  if (a.dirKey) args.dir = t(a.dirKey);
  return args;
}

export const questTitle = (def) => t(def.titleKey ?? `quest.${def.id}.title`, questArgs(def));

// What the giver says about a quest: the main story has its own words, the quests of the first town too.
export function questSpeech(def) {
  if (def.textKey) return t(def.textKey, questArgs(def));
  const key = `quest.${def.id}.text`;
  return t(key) === key ? null : t(key);
}

export function hitQuests(state, mx, my, w, h) {
  const v = view(w, h);
  const cx = v.ox + CLOSE.x * v.k;
  const cy = v.oy + CLOSE.y * v.k;
  if (Math.hypot(mx - cx, my - cy) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  const rows = questRows(state);
  for (let i = 0; i < rows.length; i++) {
    const b = buttonRect(i);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'quest', id: rows[i].def.id, status: rows[i].status };
  }
  return null;
}

// What a quest pays (or, for a quest that ends with a choice, that it depends on the answer). reward: one answer's.
export const rewardText = (def, reward = null) => {
  if (!reward && def.choices && Object.values(def.choices).some((c) => c.reward)) return t('quest.reward.byChoice');
  const r = reward ?? def.reward ?? {};
  const parts = [];
  if (r.gold) parts.push(t('hud.gold', { n: r.gold }));
  if (r.xp) parts.push(t('quest.xp', { n: r.xp }));
  if (r.item) parts.push(`${t('rarity.' + r.item.rarity)} ${itemName({ slot: r.item.slot, id: r.item.id })}`);
  return parts.join('  ');
};

export function objectiveText(def, entry = null) {
  const goal = `quest.${def.id}.goal`; // a side quest may say it in its own words
  if (def.side && t(goal) !== goal) return t(goal, { count: def.count, progress: entry?.progress ?? 0 });
  if (def.kind === 'find') return t('quest.find', { where: t(`quest.${def.id}.where`) });
  if (def.kind === 'gather') return t('quest.gather', { count: def.count, progress: entry?.progress ?? 0 });
  if (def.kind === 'deliver') return t('quest.deliver', { who: t('npc.' + (def.turnInNpc ?? 'elder')) });
  if (def.kind === 'visit') return t('quest.visit', { town: t('town.name.' + def.args.town) });
  if (def.kind === 'ending') return t('quest.ending');
  return t('quest.kill', { count: def.count, target: t('enemy.' + def.target) });
}

export function drawQuests(ctx, state, w, h) {
  const v = view(w, h);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);

  ctx.fillStyle = 'rgba(10,10,20,0.94)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(t('quest.title'), DW / 2, 38);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  const rows = questRows(state);
  // what the elder says: the story behind the next quest of the chain, or this town's own take on the Shift
  const story = rows.find((r) => r.status !== 'active' && questSpeech(r.def));
  const town = state.world?.getTownById?.(state.ui.questTown);
  const role = state.ui.questNpc ?? 'elder';
  let say = '';
  if (state.ui.firstTalk !== null && state.ui.firstTalk !== undefined) say = t('elder.first.' + state.ui.firstTalk);
  else if (story) say = questSpeech(story.def);
  else if (state.ui.rumour) say = eventText(state.ui.rumour);
  else if (role === 'elder' && town) say = t(elderLine(town, state.ending));
  else if (town) say = t(`say.${role}.${state.ui.sayLine ?? 0}`);
  if (say) {
    ctx.fillStyle = '#cfc4a8';
    ctx.font = 'italic 14px serif';
    const who = role === 'elder' && town?.elderName ? `${t('elder.title', { name: town.elderName })}: ` : `${t('npc.' + role)}: `;
    wrapText(ctx, `${who}"${say}"`, ROW.w).slice(0, 2).forEach((line, i) => ctx.fillText(line, DW / 2, 58 + i * 15));
  }
  ctx.textAlign = 'left';
  if (rows.length === 0) {
    ctx.fillStyle = '#aaa';
    ctx.font = '15px sans-serif';
    ctx.fillText(t('quest.none'), ROW.x, ROW.y + 24);
  }
  rows.forEach((row, i) => {
    const y = rowY(i);
    ctx.fillStyle = row.status === 'complete' ? 'rgba(129,199,132,0.14)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(ROW.x, y, ROW.w, ROW.h);

    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(questTitle(row.def), ROW.x + 12, y + 19);
    ctx.fillStyle = '#ddd';
    ctx.font = '13px sans-serif';
    const counted = (row.def.kind === 'kill' || row.def.kind === 'gather') && row.status !== 'available';
    ctx.fillText(objectiveText(row.def) + (counted ? `  (${row.progress}/${row.def.count})` : ''), ROW.x + 12, y + 36);
    ctx.fillStyle = '#9ccc65';
    ctx.fillText(t('quest.reward', { text: rewardText(row.def) }), ROW.x + 12, y + 52);

    const b = buttonRect(i);
    const enabled = row.status !== 'active';
    ctx.fillStyle = enabled ? '#3f6b3f' : '#2a2a2a';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = enabled ? '#8bc34a' : '#555';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = enabled ? '#fff' : '#888';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t('quest.btn.' + row.status), b.x + b.w / 2, b.y + b.h / 2 + 5);
    ctx.textAlign = 'left';
  });

  ctx.restore();
  ctx.textAlign = 'left';
}
