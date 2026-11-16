// Bitten in the back while running away (WoW's "Dazed"): half speed for a moment. Back off facing the enemy instead.
export const DAZE_MULT = 0.5;
export const DAZE_TIME = 1.5;

// Is the attacker behind a player who is on the move? (p.moveDir is the way the player walks this step.)
export const hitFromBehind = (p, from) => !!(from && p.moveDir && (from.x - p.x) * p.moveDir.x + (from.y - p.y) * p.moveDir.y < 0);

// Damage taken by the player. Lives apart from combat.js so enemies and bosses can use it without import cycles.
// `from`: the monster whose blow it was (a melee hit), for the daze.
export function damagePlayer(state, amount, from = null) {
  const p = state.player;
  if (state.dead || p.rollTime > 0) return; // rolling makes you untouchable
  const taken = Math.max(1, (amount * 50) / (50 + p.stats.defense));
  if (state.meter) state.meter.taken += taken; // the test arena counts (systems/arena.js)
  if (!state.arena?.god) p.hp -= taken;
  p.hurt = 0.15;
  p.sinceHit = 0;
  state.floaters.push({ x: p.x, y: p.y - 24, text: String(Math.round(taken)), color: '#ff5252', t: 0, dur: 0.8 });
  if (hitFromBehind(p, from)) {
    if (!(p.dazed > 0)) state.floaters.push({ x: p.x, y: p.y - 44, key: 'combat.dazed', color: '#ffcc80', t: 0, dur: 1.2 });
    p.dazed = DAZE_TIME;
  }
  if (p.hp <= 0) {
    p.hp = 0;
    state.dead = true;
    state.deadTimer = 3;
  }
}
