// Quests with consequences. Some quests end with a choice (`choices` in data/quests.json), and the world remembers it,
// the way an artifact remembers who carried it: the person who gave the job greets you differently from then on, a
// later step of the story may depend on it (`requires: "quest:choice"`), and after a while word gets around - the elder
// retells it when you ask about the place (and it goes into your chronicle), people in the street talk about it.
// A deed is a quest entry in state.player.quests with { status: 'done', choice, at }; `at` is state.clock when it was
// done. Nothing here knows about text: the keys are made by the UI (dlg.<quest>.after.<choice>, deed.*, folk.deed.*).

export const DEED_SPREAD = 240; // seconds of play before word of a deed has got around
export const FOLK_DEED_LINES = 3; // folk.deed.<quest>.<choice>.0 .. 2
export const FOLK_DEED_CHANCE = 0.5; // how often a passer-by talks about what you did rather than the weather

// The answers a quest ends with (none for most quests).
export const choicesOf = (def) => (def?.choices && typeof def.choices === 'object' ? Object.keys(def.choices) : []);

// What a quest gives: the reward of the choice made, if it has its own, else the quest's.
export const rewardOf = (def, choice) => def.choices?.[choice]?.reward ?? def.reward ?? {};

// "q_cellar_2:seal" -> { id: 'q_cellar_2', choice: 'seal' }; a plain id has no choice (ids such as "m:1" or "t:3,4:0"
// end in a number, a choice is a word).
export function parseRequirement(req) {
  const m = /^(.+):([a-z]+)$/.exec(req);
  return m ? { id: m[1], choice: m[2] } : { id: req, choice: null };
}

// The deeds done for a town (quests it gave that ended with a choice), newest first. role: only that person's.
export function deedsIn(state, townId, role = null) {
  const out = [];
  for (const [id, e] of Object.entries(state.player?.quests ?? {})) {
    if (e?.status !== 'done' || !e.choice) continue;
    const def = state.questIndex?.get(id);
    if (!def || def.giver !== townId || (role && (def.npc ?? 'elder') !== role)) continue;
    out.push({ id, def, choice: e.choice, at: e.at ?? 0 });
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}

// Has it played out yet? `greetAfter` names a quest that must be done first (the inn's cellar is walled up only once the
// mason has finished): until then nobody greets you by it, tells it or mentions it in another story.
export const greetsBy = (state, deed) => {
  const after = deed.def.choices?.[deed.choice]?.greetAfter;
  return !after || state.player?.quests?.[after]?.status === 'done';
};

// Has word of this deed got around yet? It has to have played out, and then a while has to pass.
export const hasSpread = (state, deed) => greetsBy(state, deed) && (state.clock ?? 0) - deed.at >= DEED_SPREAD;

// The deeds of a town as the elder tells them: { id: 'd:<quest>', key, args }, newest first. town: its name number.
export function deedTales(state, townId, town) {
  return deedsIn(state, townId).filter((d) => hasSpread(state, d)).map((d) => ({ id: 'd:' + d.id, key: `deed.${d.id}.${d.choice}.tale`, args: { town } }));
}

// Lines that one deed adds to another quest's story (`dlg.<base>.if.<quest>.<choice>.0`): the keys to try, in order.
// Only deeds that have played out count.
export function echoKeys(state, base) {
  const out = [];
  for (const [id, e] of Object.entries(state.player?.quests ?? {})) {
    const def = state.questIndex?.get(id);
    if (e?.status === 'done' && e.choice && def && greetsBy(state, { def, choice: e.choice })) out.push(`dlg.${base}.if.${id}.${e.choice}.0`);
  }
  return out;
}

// What a passer-by says: sometimes a line about one of your deeds here ("deed.<quest>.<choice>.<n>", read as
// folk.deed.*), else null (an ordinary line).
export function folkDeedLine(state, townId, rng = Math.random) {
  const known = deedsIn(state, townId).filter((d) => hasSpread(state, d));
  if (!known.length || rng() >= FOLK_DEED_CHANCE) return null;
  const d = known[Math.floor(rng() * known.length)];
  return `deed.${d.id}.${d.choice}.${Math.floor(rng() * FOLK_DEED_LINES)}`;
}
