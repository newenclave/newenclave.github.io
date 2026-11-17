// The skill web (docs/character.md, section 3): one field of passive skills for every hero, in the spirit of Path of
// Exile. The start is in the middle; four sectors around it (warrior, ranger, mage, rogue) and, where two meet, skills
// that only a hybrid reaches. A skill can be learned once it is linked to one already learned; each costs a point.
// Kinds: start, entry (the first skill of a sector: it trains a kind of weapon, `grants`), small, notable (a bigger
// bonus) and keystone (changes a rule, at a price: `rule`). Effects are { stat, value }, where the stat may also be an
// attribute (str, dex...). The data is in data/skills.json; nodes sit on rings around the start, at an angle.
import { recalcStats } from './stats.js';

export const START = 'start';

export function buildWeb(data) {
  const nodes = data?.nodes ?? [];
  const index = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const [a, b] of data?.links ?? []) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return { nodes, index, adj, sectors: data?.sectors ?? [], links: data?.links ?? [] };
}

export const learnedSet = (player) => (player.learned instanceof Set ? player.learned : new Set([START, ...(player.learned ?? [])]));
export const isLearned = (player, id) => id === START || learnedSet(player).has(id);

const linkedToLearned = (web, player, id) => [...(web.adj.get(id) ?? [])].some((n) => isLearned(player, n));

export function canLearn(state, id) {
  const p = state.player;
  return state.web?.index.has(id) && !isLearned(p, id) && (p.skillPoints | 0) > 0 && linkedToLearned(state.web, p, id);
}

export function learn(state, id) {
  if (!canLearn(state, id)) return false;
  const p = state.player;
  p.learned = learnedSet(p);
  p.learned.add(id);
  p.skillPoints -= 1;
  recalcStats(state);
  return true;
}

// The skills still to learn on the shortest way to `id`, in order ([] if it is learned, null if it cannot be reached).
export function pathTo(state, id) {
  const web = state.web;
  const p = state.player;
  if (!web?.index.has(id)) return null;
  if (isLearned(p, id)) return [];
  const from = new Map();
  const queue = [...learnedSet(p)];
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift();
    for (const n of web.adj.get(cur) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      from.set(n, cur);
      if (n === id) {
        const path = [];
        for (let x = id; x && !isLearned(p, x); x = from.get(x)) path.unshift(x);
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

// Learns the whole way to `id` if the points are there. Returns how many skills were learned.
export function learnPath(state, id) {
  const path = pathTo(state, id);
  if (!path?.length || path.length > (state.player.skillPoints | 0)) return 0;
  for (const n of path) learn(state, n);
  return path.length;
}

// A skill can be given back only if every other learned skill still links to the start without it.
export function canForget(state, id) {
  const p = state.player;
  if (id === START || !isLearned(p, id)) return false;
  const rest = new Set(learnedSet(p));
  rest.delete(id);
  const reached = new Set([START]);
  const queue = [START];
  while (queue.length) {
    for (const n of state.web.adj.get(queue.shift()) ?? []) {
      if (rest.has(n) && !reached.has(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  return [...rest].every((n) => reached.has(n));
}

export function forget(state, id) {
  if (!canForget(state, id)) return false;
  const p = state.player;
  p.learned = learnedSet(p);
  p.learned.delete(id);
  p.skillPoints = (p.skillPoints | 0) + 1;
  recalcStats(state);
  return true;
}

// Everything given back at once (the respec).
export function forgetAll(state) {
  const p = state.player;
  const n = learnedSet(p).size - 1;
  p.learned = new Set([START]);
  p.skillPoints = (p.skillPoints | 0) + n;
  recalcStats(state);
  return n;
}

// Learned skills from a save: only ids the web knows, and only those still linked to the start.
export function restoreLearned(web, ids) {
  const want = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && web.index.has(id)));
  const out = new Set([START]);
  const queue = [START];
  while (queue.length) {
    for (const n of web.adj.get(queue.shift()) ?? []) {
      if (want.has(n) && !out.has(n)) {
        out.add(n);
        queue.push(n);
      }
    }
  }
  return out;
}

export const hasRule = (player, rule) => !!player?.stats?.rules?.includes(rule);
export const hasGrant = (player, grant) => !!player?.stats?.grants?.includes(grant);
