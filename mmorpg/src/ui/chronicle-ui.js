import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { ensureHistory, eventById, NOW } from '../systems/history.js';
import { questArgs } from './quest-ui.js';

// The chronicle: what you have learned of the world's past (and of its possible futures), as text. Events keep raw
// values in their args; here they become words.
const named = (name, species) => (name ? t('boss.named', { name, kind: t('bestiary.name.' + species) }) : t('bestiary.name.' + species));

// The name of an artifact, from the words its story picked: "Kelmar Ashford's Promise", "The Folded Edge".
export const artName = (art) => t('art.name.' + art.form, {
  owner: art.owner, town: t('town.name.' + art.town), adj: t('art.adj.' + art.adj), noun: t(`art.noun.${art.slot}.${art.noun}`),
});

export function eventArgs(ev) {
  const a = ev.args ?? {};
  return {
    ...a,
    town: t('town.name.' + a.town),
    teller: a.teller !== undefined ? t('town.name.' + a.teller) : '',
    boss: a.species ? named(a.boss, a.species) : '',
    theme: a.theme ? t('dungeon.theme.' + a.theme) : '',
    facility: a.facility !== undefined ? t('chron.facility.' + a.facility) : '',
    fact: a.fact !== undefined ? t('chron.pulse.' + a.fact) : '',
    // "Belmond's Fang" carried by Belmond reads better as "the Fang that bore their name"
    artifact: a.art ? (a.art.form === 0 && a.owner === a.art.owner ? t('art.their', { noun: t(`art.noun.${a.art.slot}.${a.art.noun}`) }) : artName(a.art)) : '',
  };
}

export const eventText = (ev) => t(ev.key, eventArgs(ev));

// The words on a grave: a hero of the past, or the player in a future that may still happen.
export const inscription = (ev) => t(ev.future ? 'grave.future' : 'grave.hero', eventArgs(ev));

// Learned entries in the order of years; another version of an event ("id~b") is told as the rumour it was.
export function chronicleEntries(state, world) {
  const h = ensureHistory(state);
  const out = [];
  for (const id of h.learned) {
    if (id.startsWith('s:set:')) { // a set of relics, complete
      out.push({ id, year: NOW, order: 1500, text: t('relicset.chron.' + id.slice(6)), story: true });
      continue;
    }
    if (id.startsWith('s:end:')) { // the choice at the Ring
      out.push({ id, year: NOW, order: 2000, text: t(`ending.${id.slice(6)}.chron`), story: true });
      continue;
    }
    if (id.startsWith('d:')) { // a deed of yours, as the town told it back to you
      const q = state.player?.quests?.[id.slice(2)];
      const town = world.getTownById?.(state.questIndex?.get(id.slice(2))?.giver ?? '');
      const args = { town: town ? t('town.name.' + town.nameIndex) : '' };
      if (q?.choice) out.push({ id, year: NOW, order: 500 + (q.at ?? 0) / 1e6, text: t(`deed.${id.slice(2)}.${q.choice}.chron`, args), story: true });
      continue;
    }
    if (id.startsWith('s:')) { // a step of the main story you went through
      const def = state.questIndex?.get(id.slice(2));
      if (def?.chronKey) out.push({ id, year: NOW, order: 1000 + Number(id.slice(4)), text: t(def.chronKey, questArgs(def)), story: true });
      continue;
    }
    const other = id.endsWith('~b');
    const ev = eventById(state, world, other ? id.slice(0, -2) : id);
    if (!ev) continue;
    const entry = other ? { ...ev, key: 'chron.raid.otherVersion' } : ev;
    out.push({ id, year: ev.year, text: eventText(entry), future: !!ev.future, undone: ev.future && h.averted.has(ev.args.lair) });
  }
  for (const pl of h.pulses ?? []) { // the Pulses you lived through: this year, in the order they came
    const town = pl.town === null ? t('chron.pulse.nowhere') : t('town.name.' + pl.town);
    out.push({ id: `p:${pl.n}`, year: NOW, order: pl.n, text: t('chron.pulse.live.' + pl.effect, { town, biome: t('biome.' + pl.biome) }), pulse: true });
  }
  return out.sort((a, b) => a.year - b.year || (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
}

export const CHRON = { x: 30, y: 80, w: 630, h: 330 };
export const PAGE_BTNS = { prev: { x: 30, y: 418, w: 90, h: 32 }, next: { x: 570, y: 418, w: 90, h: 32 } };
const LINE = 17;

// Pages of entries that fit the box: each entry is its year and up to three wrapped lines.
export function chroniclePages(ctx, entries) {
  ctx.font = '14px serif';
  const pages = [[]];
  let used = 0;
  for (const e of entries) {
    const lines = wrapText(ctx, e.text, CHRON.w - 90).slice(0, 3);
    const need = lines.length * LINE + 8;
    if (used + need > CHRON.h && pages.at(-1).length) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1).push({ ...e, lines });
    used += need;
  }
  return pages;
}

export function drawChronicle(ctx, state, world) {
  const entries = chronicleEntries(state, world);
  ctx.textAlign = 'left';
  if (!entries.length) {
    ctx.fillStyle = '#888';
    ctx.font = 'italic 15px serif';
    wrapText(ctx, t('chron.empty'), CHRON.w).forEach((line, i) => ctx.fillText(line, CHRON.x, CHRON.y + 20 + i * 20));
    return;
  }
  const pages = chroniclePages(ctx, entries);
  const page = Math.max(0, Math.min(pages.length - 1, state.ui.chronPage ?? 0));
  state.ui.chronPage = page;
  let y = CHRON.y + 14;
  for (const e of pages[page]) {
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = e.future ? (e.undone ? '#757575' : '#80deea') : e.pulse ? '#ce93d8' : e.story ? '#ffab91' : '#ffd54f';
    ctx.fillText(e.future ? t(e.undone ? 'chron.year.undone' : 'chron.year.future', { year: e.year }) : t('chron.year', { year: e.year }), CHRON.x, y);
    ctx.font = '14px serif';
    ctx.fillStyle = e.undone ? '#888' : '#e0d6c2';
    e.lines.forEach((line, i) => ctx.fillText(line, CHRON.x + 90, y + i * LINE));
    y += e.lines.length * LINE + 8;
  }
  ctx.fillStyle = '#aaa';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t('chron.page', { n: page + 1, of: pages.length }), CHRON.x + CHRON.w / 2, PAGE_BTNS.prev.y + 21);
  for (const [k, b] of Object.entries(PAGE_BTNS)) {
    const on = k === 'prev' ? page > 0 : page < pages.length - 1;
    ctx.fillStyle = on ? '#33415c' : '#222';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = on ? '#fff' : '#555';
    ctx.fillText(k === 'prev' ? '<' : '>', b.x + b.w / 2, b.y + 21);
  }
  ctx.textAlign = 'left';
}
