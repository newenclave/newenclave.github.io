// What you wear: five pieces of armor and five pieces of jewellery, each in its own place on the body. Armor items say
// which part they cover (`part`), jewellery how it is worn (`wear`); rings and bracelets fit either of two places.
export const ARMOR_PARTS = ['head', 'chest', 'hands', 'legs', 'feet'];
export const JEWEL_SLOTS = { ring: ['ring1', 'ring2'], neck: ['neck'], wrist: ['wrist1', 'wrist2'] };
export const EQUIP_SLOTS = [...ARMOR_PARTS, 'neck', 'ring1', 'ring2', 'wrist1', 'wrist2'];

export const emptyEquipment = () => Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null]));

// The places an item can go: [] for something you do not wear (weapons, ammo).
export function placesFor(item) {
  if (item?.slot === 'armor') return ARMOR_PARTS.includes(item.part) ? [item.part] : [];
  if (item?.slot === 'accessory') return JEWEL_SLOTS[item.wear] ?? [];
  return [];
}

// Where an item goes when you put it on: the first free place it fits, else the first of them (it swaps).
export function placeFor(equipment, item) {
  const places = placesFor(item);
  return places.find((s) => !equipment[s]) ?? places[0] ?? null;
}

// Saves from before (one armor, one accessory) put on the new body: the armor on the chest, the accessory where it fits.
export function upgradeEquipment(old, rebuildItem) {
  const eq = emptyEquipment();
  if (!old || typeof old !== 'object') return eq;
  for (const [key, raw] of Object.entries(old)) {
    const expect = key === 'armor' || ARMOR_PARTS.includes(key) ? 'armor' : 'accessory';
    const item = rebuildItem(raw, expect);
    if (!item) continue;
    const place = EQUIP_SLOTS.includes(key) && placesFor(item).includes(key) ? key : placeFor(eq, item);
    if (place && !eq[place]) eq[place] = item;
  }
  return eq;
}

// Everything worn, as a list.
export const wornItems = (equipment) => EQUIP_SLOTS.map((s) => equipment?.[s]).filter(Boolean);
