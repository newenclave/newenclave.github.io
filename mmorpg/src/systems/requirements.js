// What a weapon or a piece of armor asks of the hero (docs/character.md, section 4): attributes (`req`, as the
// attribute comes to with what the skill web adds) and training from the skill web (`needs`). A weapon the hero is not
// up to can sit in the belt, but it does not strike; armor cannot be put on. Two weapons at once ask for the training
// "Two Blades". The test arena can turn all of this off (state.ignoreReqs).
import { ATTRS, attrOf } from './attributes.js';
import { hasGrant } from './skilltree.js';

// What is missing: [{ kind: 'attr', id, need, have } | { kind: 'grant', id }]; [] when the hero is up to it.
export function missingFor(state, item) {
  if (!item || state.ignoreReqs) return [];
  const p = state.player;
  const out = [];
  for (const [id, need] of Object.entries(item.req ?? {})) {
    if (ATTRS.includes(id) && attrOf(p, id) < need) out.push({ kind: 'attr', id, need, have: attrOf(p, id) });
  }
  for (const g of item.needs ?? []) if (!hasGrant(p, g)) out.push({ kind: 'grant', id: g });
  return out;
}

export const canUse = (state, item) => missingFor(state, item).length === 0;

export const canDualWield = (state) => !!state.ignoreReqs || hasGrant(state.player, 'dualWield');

// Every requirement of the item with whether the hero meets it: [{ kind, id, need?, ok }], for the item's lines.
export function requirementsOf(state, item) {
  const p = state.player;
  const out = [];
  for (const [id, need] of Object.entries(item?.req ?? {})) out.push({ kind: 'attr', id, need, ok: !!state.ignoreReqs || attrOf(p, id) >= need });
  for (const g of item?.needs ?? []) out.push({ kind: 'grant', id: g, ok: !!state.ignoreReqs || hasGrant(p, g) });
  return out;
}
