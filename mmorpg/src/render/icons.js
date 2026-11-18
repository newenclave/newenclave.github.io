// Pictures of items for the inventory, the shops and the hotbar: small pixel sprites in the letters of sprites.js.
// One picture per kind of thing; the material (leather, chain, plate), the stone of a ring or the element of an arrow
// fill the slots, so a few pictures cover every item. B: the material, A: a stone or an element.
import { SPRITES, drawSprite } from './sprites.js';

const ICONS = {
  // ---------------------------------------------------------------- weapons
  sword: [
    '...........gw.',
    '..........gwg.',
    '.........gwg..',
    '........gwg...',
    '.......gwg....',
    '......gwg.....',
    '..y..gwg......',
    '...ygwg.......',
    '....yy........',
    '...n.y........',
    '..n...y.......',
    '.n............',
    'Y.............',
  ],
  dagger: [
    '..........gw..',
    '.........gwg..',
    '........gwg...',
    '.......gwg....',
    '......gwg.....',
    '....ygwg......',
    '.....yy.......',
    '....n.y.......',
    '...n..........',
    '..Y...........',
  ],
  spear: [
    '...........gw.',
    '..........gwwg',
    '..........gwg.',
    '.........ngg..',
    '........n.....',
    '.......n......',
    '......n.......',
    '.....y........',
    '....n.........',
    '...n..........',
    '..n...........',
    '.n............',
    'N.............',
  ],
  bow: [
    '........Nn....',
    '......nn.w....',
    '.....n...w....',
    '....n....w....',
    '...n.....w....',
    '...n.....w....',
    '..yy.....w....',
    '..yy.....w....',
    '...n.....w....',
    '...n.....w....',
    '....n....w....',
    '.....n...w....',
    '......nn.w....',
    '........Nn....',
  ],
  mace: [
    '.........ggg..',
    '........gwwwg.',
    '.......gwgwgwg',
    '........gwwwg.',
    '.........ggg..',
    '........n.....',
    '.......n......',
    '......n.......',
    '.....n........',
    '....n.........',
    '...n..........',
    '..N...........',
  ],
  greatsword: [
    '............gw',
    '...........gww',
    '..........gwwg',
    '.........gwwg.',
    '........gwwg..',
    '.......gwwg...',
    '......gwwg....',
    '..yy.gwwg.....',
    '...yywwg......',
    '....yyy.......',
    '...n.yy.......',
    '..n...y.......',
    '.n............',
    'Y.............',
  ],
  wand: [
    '...........p..',
    '..........pwp.',
    '...........p..',
    '..........n...',
    '.........n....',
    '........n.....',
    '.......n......',
    '......n.......',
    '.....n........',
    '....N.........',
  ],
  crossbow: [
    '......w.......',
    '.NN...g...NN..',
    '...NnnnnnnN...',
    '..w...nN...w..',
    '...w..nN..w...',
    '....w.nN.w....',
    '.....GnNG.....',
    '......nN......',
    '......nN......',
    '......nN......',
    '.....NnNN.....',
  ],
  staff: [
    '........n.p.n.',
    '........npwpn.',
    '.........npn..',
    '.........n....',
    '........n.....',
    '.......n......',
    '......n.......',
    '.....n........',
    '....n.........',
    '...n..........',
    '..n...........',
    '.n............',
    'N.............',
  ],
  wrench: [
    '..........g.g.',
    '.........gg.gg',
    '.........gggg.',
    '........ggg...',
    '.......gg.....',
    '......gg......',
    '.....gg.......',
    '....rr........',
    '...rr.........',
    '..rr..........',
    '.rR...........',
    '.R............',
  ],
  // ---------------------------------------------------------------- armor (B: the material)
  helm: [
    '.....BBBB.....',
    '...BBLLBBBb...',
    '..BLLBBBBBBb..',
    '..BLBBBBBBBb..',
    '..BBBBBBBBBb..',
    '.bBBBBBBBBBBb.',
    '.bbbbbbbbbbbb.',
    '..Bk......kb..',
    '..Bk......kb..',
    '..bb......bb..',
  ],
  body: [
    '..bB......Bb..',
    '.bBBB....BBBb.',
    '.BBLBBBBBBBBb.',
    '.BLLBBBBBBBBb.',
    '.BLBBBBBBBBBb.',
    '..BBBBBBBBBb..',
    '..BBBBBBBBBb..',
    '..bbbbbbbbbb..',
    '..BBBBBBBBBb..',
    '...bbbbbbbb...',
  ],
  fists: [ // bare hands: a set with no weapon (systems/loadout.js)
    '..............',
    '....BBBBBB....',
    '...BbBbBbBB...',
    '...BBBBBBBBB..',
    '...BbBbBbBBB..',
    '...BBBBBBBBb..',
    '....BBBBBBb...',
    '.....BBBBb....',
    '.....BBBBb....',
    '..............',
  ],
  gloves: [
    '...B.B.B......',
    '...B.B.B.B....',
    '...BLBLBBB....',
    '...BBBBBBB.B..',
    '...BBBBBBBBB..',
    '...BBBBBBBb...',
    '....BBBBBb....',
    '....bbbbbb....',
    '....bLLLLb....',
    '....bbbbbb....',
  ],
  legs: [
    '...bbbbbbbb...',
    '...BBBBBBBBb..',
    '...BLBBBBBBb..',
    '...BLBBb.BBb..',
    '...BLBB..BBb..',
    '...BLBB..BBb..',
    '...BLBB..BBb..',
    '...BBBB..BBb..',
    '...BBBb..BBb..',
    '...bbbb..bbb..',
  ],
  boots: [
    '....BBBB......',
    '....BLBB......',
    '....BLBB......',
    '....BLBB......',
    '....BBBB......',
    '....BBBBB.....',
    '....BBBBBBB...',
    '....BBBBBBBB..',
    '....bbbbbbbb..',
  ],
  // ---------------------------------------------------------------- jewellery (A: the stone)
  ring: [
    '.....AwA......',
    '....yAAAy.....',
    '...yy...yy....',
    '..yy.....yy...',
    '..y.......y...',
    '..y.......Y...',
    '..yy.....YY...',
    '...yY...YY....',
    '....YYYYY.....',
  ],
  amulet: [
    '..y.......y...',
    '...y.....y....',
    '....y...y.....',
    '.....yyy......',
    '....yAAAy.....',
    '...yAwAAAy....',
    '...yAAAAAy....',
    '....yAAAy.....',
    '.....yyy......',
  ],
  charm: [
    '......y.......',
    '.....y.y......',
    '......y.......',
    '....AAAAA.....',
    '...AwAAAAA....',
    '...AAAAAAA....',
    '...AAAAAAb....',
    '....AAAAb.....',
    '.....AAb......',
    '......b.......',
  ],
  bracer: [
    '.....bbbbb....',
    '...bBBBBBBb...',
    '..bBLLBBBBBb..',
    '..BLyBBByBBB..',
    '..BLBBBBBBBB..',
    '..BLyBBByBBB..',
    '..bBLBBBBBBb..',
    '...bBBBBBBb...',
    '.....bbbbb....',
  ],
  // ---------------------------------------------------------------- ammunition (A: the element at the tip)
  arrows: [
    '..........AA..',
    '.........AAA..',
    '.....AA.nA....',
    '....AAAn......',
    '....nAn.......',
    '...n.n........',
    '..n.n.........',
    '.wnn..........',
    'wwn...........',
    '.w............',
  ],
  bolts: [
    '..........AA..',
    '.........AAA..',
    '........NA....',
    '.......N......',
    '......N.......',
    '.....N........',
    '....N.........',
    '..gN..........',
    '.g.g..........',
  ],
  // ---------------------------------------------------------------- things of the old world
  gear: [
    '......BB......',
    '..B...BB...B..',
    '...BBBbbBBB...',
    '...BbbbbbbB...',
    '..BBbb..bbBB..',
    'BBBBb....bBBBB',
    'BBBBb....bBBBB',
    '..BBbb..bbBB..',
    '...BbbbbbbB...',
    '...BBBbbBBB...',
    '..B...BB...B..',
    '......BB......',
  ],
  duck: [
    '......yyy.....',
    '.....yyyyy....',
    '.....yykyyoo..',
    '.....yyyyyoo..',
    '......yyyy....',
    '..yy.yyyyyy...',
    '..yyyyyyyyyy..',
    '...yyyyyyyyY..',
    '....YYYYYYY...',
  ],
  mug: [
    '..wwwwwww.....',
    '..wNNNNNw.....',
    '..wwwwwwwgg...',
    '..wwwwwwwg.g..',
    '..wwrrrwwg.g..',
    '..wwwwwwwgg...',
    '..wwwwwww.....',
    '...ggggg......',
  ],
  hardhat: [
    '.....yyyy.....',
    '...yyyyyyyy...',
    '..yyywyyyyyy..',
    '..yyyyyyyyyy..',
    '..yyyyyyyyyY..',
    'yyyyyyyyyyyyyY',
    '.YYYYYYYYYYYY.',
  ],
  phone: [
    '....kkkkkk....',
    '....kDDDDk....',
    '....kDcDDk....',
    '....kDDcDk....',
    '....kDDDck....',
    '....kDDDDk....',
    '....kDDDDk....',
    '....kkgkkk....',
  ],
  keycard: [
    '..wwwwwwwwww..',
    '..wCCCCCCCCw..',
    '..wsSwwwwwww..',
    '..wSswggggww..',
    '..wwwwwwwwww..',
    '..wwwggggwww..',
    '..wwwwwwwwww..',
  ],
};
for (const [name, rows] of Object.entries(ICONS)) SPRITES['icon_' + name] = [rows];

const MATERIAL = { leather: '#8d5a34', chain: '#9aa0a8', plate: '#d5dce4' };
const PART_ICON = { head: 'helm', chest: 'body', hands: 'gloves', legs: 'legs', feet: 'boots' };
const WEAR_ICON = { ring: 'ring', neck: 'amulet', wrist: 'bracer' };
const STONE = { // the stone of each piece of jewellery
  ring_might: '#e53935', ring_precision: '#4fc3f7', ring_swift: '#66bb6a', amulet_vigor: '#e53935', pendant_stride: '#66bb6a',
  talisman_vitality: '#f06292', charm_haste: '#66bb6a', relic_engineers_ring: '#90a4ae', relic_cold_sample: '#80deea',
};
const WRIST = { band_siphon: '#7e57c2', bracer_guard: '#78909c', relic_wristwatch_back: '#b0b0b0' };
const ELEMENT = { fire: '#ff7043', poison: '#9ccc65', frost: '#81d4fa', piercing: '#eceff1', explosive: '#ffd54f' };
// relics of the old world that have a picture of their own (or borrow one with their colours); the rest are a gear
const RELIC = {
  relic_hard_hat: ['hardhat'], relic_hivis_vest: ['body', { B: '#ff9800' }], relic_rubber_gloves: ['gloves', { B: '#ffd54f' }],
  relic_work_boots: ['boots', { B: '#a0703c' }], relic_pointer_staff: ['staff'], relic_pipe_wrench: ['wrench'],
  relic_rubber_duck: ['duck'], relic_coffee_mug: ['mug'], relic_dead_phone: ['phone'], relic_keycard: ['keycard'],
  relic_lab_badge: ['keycard'], relic_safety_glasses: ['helm', { B: '#80deea' }],
};

// The picture of an item: { name, slots } (name is a sprite in sprites.js).
export function itemIcon(item) {
  const id = item?.id ?? '';
  if (RELIC[id]) return { name: 'icon_' + RELIC[id][0], slots: RELIC[id][1] ?? {} };
  if (item.fists) return { name: 'icon_fists', slots: { B: '#e0b896' } };
  if (item.slot === 'weapon') return { name: 'icon_' + (ICONS[id] ? id : 'sword'), slots: {} };
  if (item.slot === 'armor') {
    const material = Object.keys(MATERIAL).find((m) => id.startsWith(m)) ?? 'leather';
    return { name: 'icon_' + (PART_ICON[item.part] ?? 'body'), slots: { B: MATERIAL[material] } };
  }
  if (item.slot === 'accessory') {
    if (/^(talisman|charm)/.test(id) || id === 'relic_cold_sample') return { name: 'icon_charm', slots: { A: STONE[id] ?? '#4fc3f7' } };
    const icon = WEAR_ICON[item.wear] ?? 'ring';
    return { name: 'icon_' + icon, slots: icon === 'bracer' ? { B: WRIST[id] ?? '#8d5a34' } : { A: STONE[id] ?? '#4fc3f7' } };
  }
  if (item.slot === 'ammo') {
    return { name: id.endsWith('_bolt') ? 'icon_bolts' : 'icon_arrows', slots: { A: ELEMENT[id.split('_')[0]] ?? '#eceff1' } };
  }
  return { name: 'icon_gear', slots: { B: '#9fb4bf' } }; // a thing of the old world nobody can name
}

// The picture of what goes in an empty place on the body (a dim shape).
export function placeIcon(place) {
  const part = place.replace(/\d$/, '');
  if (PART_ICON[part]) return 'icon_' + PART_ICON[part];
  if (WEAR_ICON[part]) return 'icon_' + WEAR_ICON[part];
  if (part === 'main') return 'icon_sword';
  if (part === 'off') return 'icon_dagger';
  return null;
}

// Draws an item's picture centred on (x, y). outline: a colour for its edge (the rarity), or the usual dark one.
export function drawItemIcon(ctx, item, x, y, { scale = 2, outline, flash = false } = {}) {
  const { name, slots } = itemIcon(item);
  return drawSprite(ctx, name, x, y, { scale, flash, slots: outline ? { ...slots, O: outline } : slots });
}
