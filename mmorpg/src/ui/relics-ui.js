import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { isKnown, isFound, setDone, titlesOf } from '../systems/relics.js';

// The relics page of the journal: every set, what of it you have found, what a chronicler has named, and the titles
// complete sets gave you. Unfound things stay "???".
const AREA = { x: 30, y: 80, w: 630 };

export function drawRelics(ctx, state) {
  const sets = state.relicSets ?? [];
  ctx.textAlign = 'left';
  const any = sets.some((s) => s.items.some((id) => isFound(state, id)));
  if (!any) {
    ctx.fillStyle = '#888';
    ctx.font = 'italic 15px serif';
    wrapText(ctx, t('relic.empty'), AREA.w).forEach((line, i) => ctx.fillText(line, AREA.x, AREA.y + 20 + i * 20));
    return;
  }
  let y = AREA.y + 10;
  for (const set of sets) {
    const named = set.items.filter((id) => isKnown(state, id)).length;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = setDone(state, set.id) ? '#9ccc65' : '#ffd54f';
    ctx.fillText(t('relic.progress', { set: t('relicset.' + set.id), n: named, of: set.items.length }), AREA.x, y);
    ctx.font = '13px serif';
    const names = set.items.map((id) => {
      if (isKnown(state, id)) return t('relic.' + id);
      if (isFound(state, id)) return `${t('relic.' + id)} (?)`;
      return t('relic.unfound');
    });
    ctx.fillStyle = '#e0d6c2';
    const lines = wrapText(ctx, names.join('  ·  '), AREA.w - 20).slice(0, 2);
    lines.forEach((line, i) => ctx.fillText(line, AREA.x + 14, y + 19 + i * 17));
    y += 19 + lines.length * 17 + 14;
  }
  const titles = titlesOf(state);
  if (titles.length) {
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffab91';
    ctx.fillText(t('relic.titles', { list: titles.join(', ') }), AREA.x, y + 6);
  }
}
