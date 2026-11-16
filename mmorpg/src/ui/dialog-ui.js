import { t } from '../core/i18n.js';
import { wrapText } from '../core/format.js';
import { questArgs, questTitle, questSpeech, objectiveText, rewardText } from './quest-ui.js';
import { questDef, giverRole, listForGiver } from '../systems/quests.js';
import { elderLine } from '../systems/lore.js';
import { eventText } from './chronicle-ui.js';
import { choicesOf, deedsIn, greetsBy, echoKeys, rewardOf } from '../systems/deeds.js';
import { cond, untoldClosed } from '../systems/sidequests.js';

// Talking to someone who gives quests (texts in data/lang/en.dialogue.json). It starts with a greeting and a few things
// you can say: ask what the trouble is (they tell the story behind a job, and you take it, ask for more or say not now;
// one trouble at a time, "anything else?" for the next), hand in a job done, ask about a job in progress, ask about the
// place, or say goodbye.
// A quest with consequences (systems/deeds.js) ends with a choice instead of a plain hand-in: the answers are
// dlg.<quest>.choice.<choice>, their reaction dlg.<quest>.chosen.<choice>.*, and from then on that person greets you with
// dlg.<quest>.after.<choice>.*.
// state.ui.dialog = { stage: 'hub' | 'place' | 'offer' | 'more' | 'declined' | 'chosen', id, status, choice,
// skipped: [quest ids], asked }.
// main.js does what an answer means (take, hand in); this file says what is on the screen and what was clicked.
// The people of the side stories (systems/sidequests.js, data/sidestories.json) greet you by what has happened: their
// `greet` list, the first line whose condition holds; a quest of theirs closed by something you did elsewhere is told
// once (dlg.<quest>.closed.*); a merchant or a smith with a name also offers to trade.
const DW = 760;
const DH = 540;
const PAD = 34;
const OPT = { h: 46, gap: 8 };
const CLOSE = { x: DW - 36, y: 36, r: 22 };
const MIN_TOUCH_R = 22;
const MAX_LINES = 7; // keys probed per part (offer.0, offer.1, ...)
const MAX_OPTIONS = 6;
const SAY_FONT = 'italic 20px serif';
const SAY_LINE = 27;

function view(w, h) {
  const k = Math.min(1, (w - 16) / DW, (h - 16) / DH);
  return { k, ox: (w - DW * k) / 2, oy: (h - DH * k) / 2 };
}

function hash(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

// Lines of one part of a conversation: dlg.<base>.<part>.0, .1, ... as long as they exist. After the choice at the Ring
// a part may have its own words (dlg.<base>.<part>.ended.*): nobody asks you to decide what you have decided.
function lines(base, part, args, ending = null) {
  if (ending && !part.endsWith('.ended')) {
    const after = lines(base, part + '.ended', args);
    if (after.length) return after;
  }
  const out = [];
  for (let i = 0; i < MAX_LINES; i++) {
    const key = `dlg.${base}.${part}.${i}`;
    const s = t(key, args);
    if (s === key) break;
    out.push(s.charAt(0).toUpperCase() + s.slice(1)); // "{target} roam..." -> "Slimes roam..."

  }
  return out;
}

const count = (prefix) => {
  let n = 0;
  while (n < 20 && t(`${prefix}.${n}`) !== `${prefix}.${n}`) n++;
  return n;
};

const tOr = (key, fallback) => (t(key) !== key ? t(key) : fallback);

const countVariants = (prefix) => {
  let n = 0;
  while (n < 10 && t(`dlg.${prefix}.${n}.offer.0`) !== `dlg.${prefix}.${n}.offer.0`) n++;
  return n;
};

// One of the lines dlg.<prefix>.0..n, the same one for the same `seed`.
const pick = (prefix, seed, args, fallback) => {
  const n = count(`dlg.${prefix}`);
  return n ? t(`dlg.${prefix}.${hash(seed) % n}`, args) : t(fallback, args);
};

// The conversation of a quest: the first-town quests and the main story have their own, generated quests take one of a
// few variants of their kind (the elder has their own variants where they stand in for a captain, priest or innkeeper).
export function dialogBase(def) {
  if (def.gen) {
    const prefix = `gen.${def.gen}${giverRole(def) === 'elder' ? '.elder' : ''}`;
    return `${prefix}.${hash(def.id) % Math.max(1, countVariants(prefix))}`;
  }
  if (def.textKey?.startsWith('story.')) return def.textKey.slice(6, -5); // story.m1.text -> m1
  return def.id;
}

export function dialogArgs(state, def) {
  const here = state.world?.getTownById?.(def.giver);
  // the quests of the first town name their monster only in `target` (generated ones also in args)
  const target = def.kind === 'kill' && def.target ? t('enemy.' + def.target) : undefined;
  return { count: def.count, here: here ? t('town.name.' + here.nameIndex) : '', target, ...questArgs(def) };
}

// A line for the hero's answer: a special one for this quest, or one of the common ones (the same for the same quest).
function reply(def, base, kind, ending = null) {
  const after = `dlg.${base}.reply.${kind}.ended`; // after the choice at the Ring the hero may say something else
  if (ending && t(after) !== after) return t(after);
  const own = `dlg.${base}.reply.${kind}`;
  return t(own) !== own ? t(own) : pick(`reply.${kind}`, def.id + kind, {}, `dlg.fallback.${kind}`);
}

export function openDialog(state) {
  const ui = state.ui;
  ui.dialog = { stage: 'hub', skipped: [], asked: 0, closed: null, greet: null };
  // a job of theirs that something you did closed: they say so, once
  const shut = untoldClosed(state, ui.questTown, ui.questNpc ?? 'elder')[0];
  if (shut) {
    shut.entry.told = true;
    ui.dialog.closed = shut.def.id;
  } else ui.dialog.greet = pickGreeting(state, ui.questNpc ?? 'elder');
}

const TRADERS = ['merchant', 'trader', 'blacksmith'];

// A named person's greeting: the first of their `greet` rules whose condition holds. A rule says one of its lines
// (one by the talk), or with `once` all of them in order, the first time only (then the next rule speaks).
// The rule is picked when the talk opens (openDialog) so a line said once is not taken back while you read it.
function pickGreeting(state, role) {
  const person = state.people?.get(role);
  for (const g of person?.def.greet ?? []) {
    if (!cond(state, g.when)) continue;
    if (g.once && state.player.heard?.includes(g.once)) continue;
    const keys = Array.isArray(g.say) ? g.say : [g.say];
    if (g.once) {
      (state.player.heard ??= []).push(g.once);
      return keys.map((k) => (k.startsWith('>') ? `— ${t(k.slice(1))}` : t(k))); // ">key": the hero's own words
    }
    return [t(keys[(state.ui.sayLine ?? 0) % keys.length])];
  }
  return null;
}

// The person's first words, and what they know about the place. Someone you did a deed for remembers what you chose.
function greeting(state, role, town) {
  if (state.ui.firstTalk !== null && state.ui.firstTalk !== undefined) return t('elder.first.' + state.ui.firstTalk);
  const shut = state.ui.dialog?.closed;
  if (shut) {
    const said = lines(dialogBase(questDef(state, shut)), 'closed', {});
    if (said.length) return said;
  }
  const own = state.ui.dialog?.greet;
  if (own) return own;
  const deed = town && deedsIn(state, town.id, role).find((d) => greetsBy(state, d));
  if (deed) {
    const prefix = `dlg.${dialogBase(deed.def)}.after.${deed.choice}`;
    const n = count(prefix);
    if (n) return t(`${prefix}.${(state.ui.sayLine ?? 0) % n}`);
  }
  if (role === 'elder' && town) return t(elderLine(town, state.ending));
  const key = `say.${role}.${state.ui.sayLine ?? 0}`;
  return t(key) !== key ? t(key) : t(`say.${state.ui.talkNpc?.id ?? role}.${state.ui.sayLine ?? 0}`);
}
function placeTalk(state, role, town) {
  if (state.ui.rumour) return eventText(state.ui.rumour);
  if (role === 'elder' && town) return t(elderLine(town, state.ending));
  const key = `say.${role}.${((state.ui.sayLine ?? 0) + 1) % 3}`;
  return t(key) !== key ? t(key) : t(`say.${state.ui.talkNpc?.id ?? role}.${((state.ui.sayLine ?? 0) + 1) % 3}`);
}

// The things you can say to this person now (the hub of the conversation).
function topics(state, role) {
  const d = state.ui.dialog;
  const rows = listForGiver(state, state.ui.questTown, role);
  const out = [];
  for (const r of rows.filter((r) => r.status === 'complete')) out.push({ kind: 'done', id: r.def.id, text: t('dlg.ask.done', { title: questTitle(r.def) }) });
  // story quests first: the one trouble they tell you about now
  const open = rows.filter((r) => r.status === 'available' && !d.skipped.includes(r.def.id)).sort((a, b) => (b.def.story ? 1 : 0) - (a.def.story ? 1 : 0));
  if (open.length) {
    out.push({ kind: 'ask', id: open[0].def.id, text: pick(d.asked ? 'ask.else' : 'ask.trouble', state.ui.questTown + role, {}, 'dlg.fallback.ask') });
  }
  for (const r of rows.filter((r) => r.status === 'active')) out.push({ kind: 'job', id: r.def.id, text: t('dlg.ask.job', { title: questTitle(r.def) }) });
  const npc = state.ui.talkNpc;
  if (npc?.person && TRADERS.includes(npc.id)) out.push({ kind: 'trade', text: t('dlg.ask.trade.' + (npc.id === 'blacksmith' ? 'smith' : 'shop')) });
  out.push({ kind: 'place', text: pick('ask.place', state.ui.questTown + role, {}, 'dlg.fallback.place') });
  out.push({ kind: 'bye', text: pick('ask.bye', state.ui.questTown + role, {}, 'dlg.fallback.bye') });
  return out.slice(-MAX_OPTIONS);
}

// What is on the screen: who speaks, what they say, the job under discussion (if any) and the answers you can pick.
export function dialogView(state) {
  const d = state.ui.dialog;
  if (!d) return null;
  const role = state.ui.questNpc ?? 'elder';
  const town = state.world?.getTownById?.(state.ui.questTown);
  if (d.stage === 'hub') return { def: null, role, say: [greeting(state, role, town)].flat(), options: topics(state, role) };
  if (d.stage === 'place') return { def: null, role, say: [placeTalk(state, role, town)], options: [{ kind: 'back', text: t('dlg.back') }] };
  const def = questDef(state, d.id);
  if (!def) return null;
  const base = dialogBase(def);
  const args = dialogArgs(state, def);
  let say;
  let options;
  if (d.stage === 'chosen') { // what they say to your answer
    say = lines(base, `chosen.${d.choice}`, args, state.ending);
    if (!say.length) say = [t('dlg.fallback.done')];
    options = [{ kind: 'back', text: t('dlg.back') }];
  } else if (d.stage === 'declined') {
    say = [pick(`decline.${role}`, def.id, {}, 'dlg.fallback.declined')];
    options = [{ kind: 'back', text: t('dlg.back') }];
  } else if (d.status === 'complete') {
    say = lines(base, 'done', args, state.ending);
    if (!say.length) say = [t('dlg.fallback.done')];
    const choices = choicesOf(def);
    options = choices.length
      ? choices.map((choice) => ({ kind: 'choose', choice, text: tOr(`dlg.${base}.choice.${choice}`, choice), note: rewardText(def, rewardOf(def, choice)) }))
      : [{ kind: 'turnin', text: reply(def, base, 'turnin') }];
  } else if (d.status === 'active') {
    say = lines(base, 'wait', args, state.ending);
    if (!say.length) say = [objectiveText(def)];
    options = [{ kind: 'back', text: reply(def, base, 'ok') }];
  } else {
    say = lines(base, d.stage === 'more' ? 'more' : 'offer', args, state.ending);
    if (d.stage !== 'more') { // what your choices elsewhere changed here, after the story it belongs to
      say = [...say, ...echoKeys(state, base).filter((k) => t(k) !== k).map((k) => t(k, args))];
    }
    if (!say.length && d.stage !== 'more') say = [questSpeech(def) ?? objectiveText(def)];
    const more = d.stage !== 'more' && lines(base, 'more', args).length > 0;
    options = [{ kind: 'accept', text: reply(def, base, 'accept', state.ending) }];
    if (more) options.push({ kind: 'more', text: reply(def, base, 'more') });
    options.push({ kind: 'decline', text: reply(def, base, 'decline') });
  }
  return { def, role, say, options };
}

const optionRect = (i, n) => ({ x: PAD, y: DH - PAD - (n - i) * (OPT.h + OPT.gap) + OPT.gap, w: DW - 2 * PAD, h: OPT.h });

// What a click hits: the close button ({ kind: 'close' }) or one of the answers (the option itself).
export function hitDialog(state, mx, my, w, h) {
  const v = view(w, h);
  const cx = v.ox + CLOSE.x * v.k;
  const cy = v.oy + CLOSE.y * v.k;
  if (Math.hypot(mx - cx, my - cy) <= Math.max(CLOSE.r * v.k, MIN_TOUCH_R)) return { kind: 'close' };
  const dv = dialogView(state);
  if (!dv) return null;
  const x = (mx - v.ox) / v.k;
  const y = (my - v.oy) / v.k;
  const n = dv.options.length;
  for (let i = 0; i < n; i++) {
    const b = optionRect(i, n);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return dv.options[i];
  }
  return null;
}

// Where an answer is on the screen (for tests).
export function dialogOptionCentre(state, kind, w, h) {
  const dv = dialogView(state);
  const i = dv?.options.findIndex((o) => o.kind === kind) ?? -1;
  if (i < 0) return null;
  const v = view(w, h);
  const b = optionRect(i, dv.options.length);
  return { x: v.ox + (b.x + b.w / 2) * v.k, y: v.oy + (b.y + b.h / 2) * v.k };
}

export function drawDialog(ctx, state, w, h) {
  const dv = dialogView(state);
  if (!dv) return;
  const v = view(w, h);
  ctx.save();
  ctx.translate(v.ox, v.oy);
  ctx.scale(v.k, v.k);

  ctx.fillStyle = 'rgba(14,12,20,0.96)';
  ctx.fillRect(0, 0, DW, DH);
  ctx.strokeStyle = '#6d5a3a';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, DW - 2, DH - 2);

  ctx.strokeStyle = '#888';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CLOSE.x, CLOSE.y, CLOSE.r, 0, Math.PI * 2);
  ctx.moveTo(CLOSE.x - 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x + 8, CLOSE.y + 8);
  ctx.moveTo(CLOSE.x + 8, CLOSE.y - 8); ctx.lineTo(CLOSE.x - 8, CLOSE.y + 8);
  ctx.stroke();

  // who speaks (and, in a talk about a job, which job)
  const town = state.world?.getTownById?.(state.ui.questTown);
  const who = dv.role === 'elder' && town?.elderName ? t('elder.title', { name: town.elderName }) : t('npc.' + dv.role);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0c890';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(who, PAD, 46);
  let y = 84;
  if (dv.def) {
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(questTitle(dv.def), PAD, 74);
    y = 108;
  }

  // what they say, line after line
  const optTop = optionRect(0, dv.options.length).y;
  const jobShown = dv.def && state.ui.dialog.stage !== 'declined';
  const sayBottom = optTop - (jobShown ? 56 : 14);
  ctx.fillStyle = '#efe4c8';
  ctx.font = SAY_FONT;
  for (const s of dv.say) {
    for (const line of wrapText(ctx, `"${s}"`, DW - 2 * PAD)) {
      if (y > sayBottom) break;
      ctx.fillText(line, PAD, y);
      y += SAY_LINE;
    }
    y += 10;
  }

  // the job itself, small, under the story
  if (jobShown) {
    ctx.fillStyle = '#ccc';
    ctx.font = '16px sans-serif';
    ctx.fillText(objectiveText(dv.def), PAD, optTop - 34);
    ctx.fillStyle = '#9ccc65';
    ctx.fillText(t('quest.reward', { text: rewardText(dv.def) }), PAD, optTop - 12);
  }

  // your answers
  dv.options.forEach((o, i) => {
    const b = optionRect(i, dv.options.length);
    const main = o.kind === 'accept' || o.kind === 'turnin' || o.kind === 'done';
    ctx.fillStyle = main ? 'rgba(63,107,63,0.9)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = main ? '#8bc34a' : '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#fff';
    ctx.font = '18px sans-serif';
    const noteW = o.note ? 230 : 0; // an answer of a choice shows what it pays, on the right
    ctx.fillText(`${i + 1}. ${o.text}`, b.x + 16, b.y + 30, b.w - 32 - noteW);
    if (o.note) {
      ctx.fillStyle = '#9ccc65';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(o.note, b.x + b.w - 14, b.y + 29, noteW - 10);
      ctx.textAlign = 'left';
    }
  });

  ctx.restore();
  ctx.textAlign = 'left';
}
