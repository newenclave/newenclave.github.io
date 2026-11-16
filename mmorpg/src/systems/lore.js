import { hash2 } from '../core/rng.js';

// The story told by the world itself (see docs/story.md): what elders say, the notes found in chests, the line that
// opens a new game. Only picks language keys; the texts live in data/lang/.
export const ELDER_LINES = 3; // elder.say.<kind>.0 .. 2, for every size of settlement
export const NOTE_LINES = 3; // note.<pool>.0 .. 2
export const NOTE_POOLS = ['crypt', 'ice', 'tomb', 'cave', 'valley', 'pulse'];
export const NOTE_TIME = 9; // seconds a note stays on screen

const pick = (id, salt, n) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.floor(hash2(h, salt, 4242) * n);
};

// What the elder of this town says about the Shift. Every town keeps its own version; round towns of older worlds
// count as towns.
// After the choice at the Ring, every elder talks about the world it made instead.
export const elderLine = (town, ending = null) => (ending
  ? `elder.after.${ending}.${pick(town.id, 2, ELDER_LINES)}`
  : `elder.say.${town.kind ?? 'town'}.${pick(town.id, 1, ELDER_LINES)}`);

// The note in a chest: the pool follows the place (a dungeon theme, a cave, a hidden valley), the line the chest.
export function notePool(runId, theme) {
  if (runId?.startsWith('v:')) return 'valley';
  if (runId?.startsWith('c:')) return 'cave';
  if (runId?.startsWith('p:')) return 'pulse';
  return NOTE_POOLS.includes(theme) ? theme : null;
}
export const noteKey = (pool, runId, idx) => `note.${pool}.${pick(runId, idx + 7, NOTE_LINES)}`;
