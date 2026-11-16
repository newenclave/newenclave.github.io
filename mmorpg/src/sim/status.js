// Things that happen to a monster after it was hit: burning, poison (damage over time) and being slowed.
export const DOT_STEP = 0.5; // seconds between two ticks of damage

export function applyDot(e, kind, dps, time) {
  e.dots ??= [];
  const cur = e.dots.find((d) => d.kind === kind);
  if (cur) { // hit again: the stronger one wins and the clock restarts
    cur.dps = Math.max(cur.dps, dps);
    cur.left = time;
  } else {
    e.dots.push({ kind, dps, left: time, acc: 0 });
  }
}

// Bosses cannot be slowed. Returns whether the slow took hold.
export function applySlow(e, mult, time) {
  if (e.boss) return false;
  e.slowMult = e.slowLeft > 0 ? Math.min(e.slowMult, mult) : mult;
  e.slowLeft = Math.max(e.slowLeft ?? 0, time);
  return true;
}

export const speedFactor = (e) => (e.slowLeft > 0 ? e.slowMult : 1);
