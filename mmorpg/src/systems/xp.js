import { recalcStats } from './stats.js';
import { PER_LEVEL } from './attributes.js';

export const xpToNext = (level) => Math.round(40 * Math.pow(level, 1.4));

export function grantXp(state, amount) {
  const p = state.player;
  p.xp += amount;
  let leveled = false;
  while (p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.skillPoints++;
    p.attrPoints = (p.attrPoints | 0) + PER_LEVEL;
    leveled = true;
  }
  if (leveled) {
    recalcStats(state);
    p.hp = p.maxHp;
    state.floaters.push({ x: p.x, y: p.y - 50, text: 'LEVEL UP', key: 'hud.levelup', color: '#ffd54f', t: 0, dur: 2 });
  }
}
