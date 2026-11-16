import { recalcStats } from './stats.js';

export function rankOf(player, id) {
  return player.ranks[id] | 0;
}

export function missingRequirements(player, node) {
  return node.requires.filter((id) => rankOf(player, id) < 1);
}

export function canRank(player, node) {
  return player.skillPoints > 0
    && rankOf(player, node.id) < node.maxRank
    && missingRequirements(player, node).length === 0;
}

export function rankUp(state, id) {
  const node = state.skillIndex.get(id);
  const p = state.player;
  if (!node || !canRank(p, node)) return false;
  p.ranks[id] = rankOf(p, id) + 1;
  p.skillPoints--;
  recalcStats(state);
  return true;
}
