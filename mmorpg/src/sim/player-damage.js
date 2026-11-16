// Damage taken by the player. Lives apart from combat.js so enemies and bosses can use it without import cycles.
export function damagePlayer(state, amount) {
  const p = state.player;
  if (state.dead || p.rollTime > 0) return; // rolling makes you untouchable
  const taken = Math.max(1, (amount * 50) / (50 + p.stats.defense));
  p.hp -= taken;
  p.hurt = 0.15;
  p.sinceHit = 0;
  state.floaters.push({ x: p.x, y: p.y - 24, text: String(Math.round(taken)), color: '#ff5252', t: 0, dur: 0.8 });
  if (p.hp <= 0) {
    p.hp = 0;
    state.dead = true;
    state.deadTimer = 3;
  }
}
