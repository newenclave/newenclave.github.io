// Pixel art: every sprite is a few rows of letters, one letter a pixel (see PAL). Each sprite gets a dark outline
// of its own, and is drawn scaled up with sharp edges. Some letters are slots filled per drawing: B is the body
// colour (a monster's own colour, so a boss of the same kind looks different), b and L its dark and light shades,
// T and t the clothes, h the hair, A an accent (a bow, an apron), O the outline.
//
// People and some monsters are seen from every side: their views (sprite-views.js) become sprites named
// "hero.s", "hero.se", "hero.e", "hero.ne", "hero.n"; the west side is the east side mirrored.

import { VIEW_DATA } from './sprite-views.js';

export const PAL = {
  k: '#1b1622', w: '#f4f1e8', g: '#b8b4c0', G: '#77727f', D: '#46424e',
  r: '#d63c3c', R: '#8e1f2a', y: '#ffd54f', Y: '#c99a2e', o: '#ff8a3d',
  s: '#f1c6a0', S: '#c98f6a', n: '#8d5a34', N: '#5a3820', e: '#241c2c',
  c: '#8fe3ff', C: '#3f8fc0', p: '#a463d8', f: '#3f8f3a', F: '#24592a', l: '#74c457', m: '#e3d3a8',
};
const SLOTS = { B: '#9e9e9e', T: '#3a78c8', h: '#5b3a24', A: '#8d5a34', O: '#120e18' };

// Legs for people: standing, and in a step.
const LEGS = {
  stand: ['.....NN..NN.....', '.....NN..NN.....', '....kkk..kkk....'],
  step: ['....NN....NN....', '....NN....NN....', '...kkk....kkk...'],
};
const HEAD = [
  '................',
  '.....hhhhhh.....',
  '....hhhhhhhh....',
  '...hhhhhhhhhh...',
  '...hhsssssshh...',
  '...hssessessh...',
  '...hssssssssh...',
  '....SssssssS....',
];
const person = (body) => [[...HEAD, ...body, ...LEGS.stand], [...HEAD, ...body, ...LEGS.step]];

export const SPRITES = {
  // ---------------------------------------------------------------- people
  hero: person([
    '....tTTTTTTt....',
    '...sTTTTTTTTs...',
    '...stTTTTTTts...',
    '....nnnynnnn....',
    '....tTTttTTt....',
  ]),
  villager: person([
    '....tTTTTTTt....',
    '...sTAAAAAATs...',
    '...sTAAAAAATs...',
    '....tAAAAAAt....',
    '....tAAAAAAt....',
  ]),
  guard: [[
    '................',
    '.....gggggg.....',
    '....gwgggggg....',
    '...gggggggggg...',
    '...GGGGGGGGGG...',
    '...GssessessG...',
    '...GssssssssG...',
    '....SssssssS....',
    '...gTTTTTTTTg...',
    '..sgTTTTTTTTgs..',
    '..s.TTTTTTTT.s..',
    '....nnnynnnn....',
    '....GggggggG....',
    ...LEGS.stand,
  ]],
  robe: [[
    '................',
    '......TTTT......',
    '....TTTTTTTT....',
    '...TTtssssstT...',
    '...TtssessesT...',
    '...TtsssssstT...',
    '...TTtSSSStTT...',
    '....TTTTTTTT....',
    '...TTTTyTTTTT...',
    '..sTTTTttTTTTs..',
    '...TTTTttTTTT...',
    '...TTTTttTTTT...',
    '..TTTTTttTTTTT..',
    '..TTTTTttTTTTT..',
    '..tTTTTttTTTTt..',
    '...NN......NN...',
  ]],
  royal: [[
    '.....y.yy.y.....',
    '.....yryyry.....',
    '....hhhhhhhh....',
    '...hhsssssshh...',
    '...hssessessh...',
    '...hssssssssh...',
    '...hhSssssShh...',
    '....hSssssSh....',
    '...RTTTTTTTTR...',
    '..RRTTTyyTTTRR..',
    '..RRsTTTTTTsRR..',
    '..RRTTyyyyTTRR..',
    '..RRTTTTTTTTRR..',
    '..RR.TT..TT.RR..',
    '..R..NN..NN..R..',
    '....kkk..kkk....',
  ]],

  // ---------------------------------------------------------------- monsters
  slime: [[
    '................',
    '................',
    '................',
    '................',
    '................',
    '......BBBB......',
    '....BBLLBBBB....',
    '...BBLwLBBBBB...',
    '..BBBLLBBBBBBB..',
    '..BBBBBBBBBBBB..',
    '.BBBeBBBBBeBBBB.',
    '.BBBeBBBBBeBBBB.',
    '.BBBBBBBBBBBBBb.',
    '.bBBBBBBBBBBBbb.',
    '..bbbbbbbbbbbb..',
    '................',
  ]],
  wolf: [[
    '................',
    '...........B.B..',
    '...........BBB..',
    '..........BBeBB.',
    'B.........BBBBBk',
    'BB..BBBBBBBBBbb.',
    '.BBBBBBBBBBBBL..',
    '..BLLLLBBBBBB...',
    '..BBLLLBBBBBB...',
    '..BB..B...BB....',
    '..B...B...B.B...',
    '.bb..bb..bb.bb..',
  ], [
    '................',
    '...........B.B..',
    '...........BBB..',
    '..........BBeBB.',
    'B.........BBBBBk',
    'BB..BBBBBBBBBbb.',
    '.BBBBBBBBBBBBL..',
    '..BLLLLBBBBBB...',
    '..BBLLLBBBBBB...',
    '..BB...B..BB....',
    '.B.....B....B...',
    'bb....bb...bb...',
  ]],
  boar: [[
    '................',
    '................',
    '....bbbbbb......',
    '..bbBBBBBBBb....',
    '.bBBBBBBBBBBBB..',
    'bBBBBBBBBBBBeBB.',
    'bBBBBBBBBBBBBBLL',
    '.BBBBBBBBBBBBBkL',
    '.BBLLLLLBBBBBw..',
    '..BB..B...BB....',
    '..BB..B...BB....',
    '..kk..k...kk....',
  ], [
    '................',
    '................',
    '....bbbbbb......',
    '..bbBBBBBBBb....',
    '.bBBBBBBBBBBBB..',
    'bBBBBBBBBBBBeBB.',
    'bBBBBBBBBBBBBBLL',
    '.BBBBBBBBBBBBBkL',
    '.BBLLLLLBBBBBw..',
    '..BB...B..BB....',
    '.BB....B...BB...',
    '.kk....k...kk...',
  ]],
  scorpion: [[
    '....BBBB........',
    '...B....Bk......',
    '..B......k......',
    '..B.............',
    '..BB............',
    '...BBBBBBBB..BB.',
    '..bBBBBBBBBBBB.B',
    '..bBBBBBBBBBeB..',
    '...bBBBBBBBBBBB.',
    '...B.B.B.B..BB.B',
    '..B.B.B.B.......',
    '................',
  ], [
    '....BBBB........',
    '...B....Bk......',
    '..B......k......',
    '..B.............',
    '..BB............',
    '...BBBBBBBB..BB.',
    '..bBBBBBBBBBBB.B',
    '..bBBBBBBBBBeB..',
    '...bBBBBBBBBBBB.',
    '..B.B.B.B...BB.B',
    '...B.B.B.B......',
    '................',
  ]],
  goblin: [[
    '................',
    '................',
    '.....BBBBBB.....',
    'B...BBBBBBBB...B',
    'BB.BBBBBBBBBB.BB',
    '.BBBBrBBBBrBBBB.',
    '..BBBBBBBBBBBB..',
    '...BBBkkkkBBB...',
    '....bBBBBBBb....',
    '...nNnnnnnnNn...',
    '..BnnnnnnnnnnB..',
    '..BNnnnnnnnnNB..',
    '....nnnnnnnn....',
    '....BB....BB....',
    '....BB....BB....',
    '...NNN....NNN...',
  ], [
    '................',
    '................',
    '.....BBBBBB.....',
    'B...BBBBBBBB...B',
    'BB.BBBBBBBBBB.BB',
    '.BBBBrBBBBrBBBB.',
    '..BBBBBBBBBBBB..',
    '...BBBkkkkBBB...',
    '....bBBBBBBb....',
    '...nNnnnnnnNn...',
    '..BnnnnnnnnnnB..',
    '..BNnnnnnnnnNB..',
    '....nnnnnnnn....',
    '...BB......BB...',
    '...BB......BB...',
    '..NNN......NNN..',
  ]],
  skeleton: [[
    '................',
    '.....BBBBBB.....',
    '....BBBBBBBB....',
    '....BkkBBkkB....',
    '....BkrBBkrB....',
    '....BBBbbBBB....',
    '.....BkBkBk..A..',
    '......BBBB....A.',
    '....bBkBBkBb..A.',
    '...B.BkBBkB.B.A.',
    '...B.BBBBBB.BBA.',
    '...b..bBBb....A.',
    '.....BBBBBB..A..',
    '.....B....B.....',
    '.....B....B.....',
    '....BB....BB....',
  ], [
    '................',
    '.....BBBBBB.....',
    '....BBBBBBBB....',
    '....BkkBBkkB....',
    '....BkrBBkrB....',
    '....BBBbbBBB....',
    '.....BkBkBk..A..',
    '......BBBB....A.',
    '....bBkBBkBb..A.',
    '...B.BkBBkB.B.A.',
    '...B.BBBBBB.BBA.',
    '...b..bBBb....A.',
    '.....BBBBBB..A..',
    '....B......B....',
    '....B......B....',
    '...BB......BB...',
  ]],
  mage: [[
    '.........B......',
    '........BB......',
    '.......BBB......',
    '......BBBBB.....',
    '.....BBBBBBB....',
    '...bbbbbbbbbbb..',
    '.....SsesesS....',
    '.....SsssssS....',
    '....BBwwwwwBB...',
    '...BBBBwwwBBBB.y',
    '..sBBBBBwBBBBBsn',
    '...BBBBBBBBBB..n',
    '...BBBBybBBBB..n',
    '...bBBBBBBBBb..n',
    '..bBBBBBBBBBBb.n',
    '...kk......kk..n',
  ]],
  golem: [[
    '....................',
    '......bBBBBBBb......',
    '.....bBBBBBBBBb.....',
    '.....BBccBBccBB.....',
    '.....BBBBBBBBBB.....',
    '.....bBBkkkkBBb.....',
    '..bBBBbBBBBBBbBBBb..',
    '.bBBBBBBBLLBBBBBBBb.',
    '.BBBBbBBLLLLBBbBBBB.',
    '.BBB.bBBBccBBBb.BBB.',
    '.BBB.bBBBBBBBBb.BBB.',
    '.bBb.BBBBBBBBBB.bBb.',
    '.BBB..bBBBBBBb..BBB.',
    '......BBBBBBBB......',
    '.....BBBb..bBBB.....',
    '.....BBBb..bBBB.....',
    '.....BBBb..bBBB.....',
    '....bBBBb..bBBBb....',
    '....bbbbb..bbbbb....',
    '....................',
  ]],
  troll: [[
    '....................',
    '.......BBBBBB.......',
    '......BBBBBBBB......',
    '..B..BBeBBBBeBB..B..',
    '..BBBBBBBBBBBBBBBB..',
    '......BwBBBBwB......',
    '.....bBBBBBBBBb.....',
    '...bBBBBBBBBBBBBb...',
    '..bBBBnnnnnnnnBBBb..',
    '.bBBB.nnnnnnnn.BBBb.',
    '.BBB..nNnnnnNn..BBB.',
    '.BBB..nnnnnnnn..BBN.',
    '.bBb..BBBBBBBB..BNN.',
    '......BBBBBBBB...NN.',
    '......BBB..BBB...NN.',
    '......BBB..BBB...NN.',
    '......BBB..BBB....N.',
    '.....bBBB..BBBb.....',
    '.....bbbb..bbbb.....',
    '....................',
  ]],
  bat: [[
    'B..............B',
    'BB............BB',
    'BBB...b..b...BBB',
    '.BBB..bbbb..BBB.',
    '.BBBBBBBBBBBBBB.',
    '..BBBBrBBrBBBB..',
    '...BBBBwwBBBB...',
    '....B.BBBB.B....',
    '......b..b......',
    '................',
  ], [
    '................',
    '................',
    '......b..b......',
    '......bbbb......',
    '...BBBBBBBBBB...',
    '..BBBBrBBrBBBB..',
    '.BBBBBBwwBBBBBB.',
    'BBB.B.BBBB.B.BBB',
    'BB....b..b....BB',
    'B..............B',
  ]],
  harpy: [[
    'BB............BB',
    'BBB....hh....BBB',
    '.BBB..hssh..BBB.',
    '.BBBB.sese.BBBB.',
    '..BBBBhsshBBBB..',
    '...BBBBLLBBBB...',
    '.....BBLLBB.....',
    '......BBBB......',
    '......B..B......',
    '.....yy..yy.....',
  ], [
    '................',
    '.......hh.......',
    '......hssh......',
    '......sese......',
    '...BBBhsshBBB...',
    '.BBBBBBLLBBBBBB.',
    'BBBB.BBLLBB.BBBB',
    'BBB...BBBB...BBB',
    'BB....B..B....BB',
    '.....yy..yy.....',
  ]],
  wyvern: [[
    '....BB............BB....',
    '...BBBb..........bBBB...',
    '..BBBbb..........bbBBB..',
    '.BBBbbb..........bbbBBB.',
    '.BBbbbbB........BbbbbBB.',
    '..bbbbbBB......BBbbbbb..',
    '....bbbBBB....BBBbbbBB..',
    'B.....BBBBBBBBBBBBBBBeB.',
    'BB..BBBBLLLLLLBBBBBBBBww',
    '.BBBBBBLLLLLLLLBBB......',
    '...BBb..BBLLBB..........',
    '........B....B..........',
    '.......yy...yy..........',
    '........................',
  ], [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '....................BB..',
    'B.....BBBBBBBBBBBBBBBeB.',
    'BB..BBBBLLLLLLBBBBBBBBww',
    '.BBBBbbbLLLLLLLLbbbB....',
    '...bbbbbbBLLBbbbbbb.....',
    '..BBbbbb.B..B.bbbbBB....',
    '.BBB....yy.yy....BBB....',
    'BB..................BB..',
  ]],
  crown: [[
    '.y.yy.y.',
    '.yyyyyy.',
    '.yryyry.',
  ]],

  // ---------------------------------------------------------------- the land
  tree: [[
    '......FFFF......',
    '....FFfffFFF....',
    '...FfflllffFF...',
    '..FfflllllffFF..',
    '..FffllllfffFF..',
    '.FffflllffffFFF.',
    '.FfffffffffffFF.',
    '.FFfffffffffFFF.',
    '..FFffffffFFFF..',
    '...FFFFFFFFFF...',
    '.....FFnNFF.....',
    '......nnN.......',
    '......nnN.......',
    '.....nnnNN......',
  ]],
  pine: [[
    '.......F........',
    '......FfF.......',
    '......wfF.......',
    '.....wwfFF......',
    '.....FffFF......',
    '....wwwffFF.....',
    '....FfffffF.....',
    '...wwwwffffF....',
    '...FFfffffFFF...',
    '..wwwwwfffffFF..',
    '..FFFfffffFFFF..',
    '.......nN.......',
    '.......nN.......',
  ]],
  bush: [[
    '....FFFF....',
    '..FFflfFFF..',
    '.FfllllffFF.',
    'FffllfffffFF',
    'FffffffffffF',
    '.FFffffffFF.',
    '..FFFFFFFF..',
  ]],
  rock: [[
    '....gggg....',
    '..ggwggGG...',
    '.gwgggGGGG..',
    '.ggggGGGGDD.',
    'gggGGGGGDDDD',
    '.GGGGDDDDDD.',
  ]],
  cactus: [[
    '....ll....',
    '...lflF...',
    '...lfF....',
    '.l.lfF....',
    '.lflfF.l..',
    '.lffffFlF.',
    '..FFffFfF.',
    '...lffFF..',
    '...lfF....',
    '...lfF....',
    '...lfF....',
  ]],
  flowers: [[
    '..y.....',
    '.yry..p.',
    '..y..pwp',
    '.l.l..p.',
    '..ll.l..',
    '...ll...',
  ]],
  tuft: [[
    'l..l..',
    '.l.l.l',
    '.lfl.l',
  ]],
  stone: [[
    '..gggg..',
    '.gwggGG.',
    '.gggGGG.',
    '.ggGgGG.',
    '.gggGGD.',
    '.gGggGD.',
    '.gggGGD.',
    '.ggGGGD.',
    '.gggGDD.',
    'lgGGGDDl',
  ]],

  // ---------------------------------------------------------------- things
  chest: [[
    '..nnnnnnnnnn..',
    '.nNnnnnnnnnNn.',
    '.nNnnnnnnnnNn.',
    '.yyyyyyyyyyyy.',
    '.nNnnnyynnnNn.',
    '.nNnnnYynnnNn.',
    '.nNnnnnnnnnNn.',
    '.yyyyyyyyyyyy.',
    '.NNNNNNNNNNNN.',
  ]],
  chest_open: [[
    '..nnnnnnnnnn..',
    '.nNNNNNNNNNNn.',
    '.nkkkkkkkkkkn.',
    '.YYYYYYYYYYYY.',
    '.NnNnnnnnnnNN.',
    '.NnNnnnnnnnNN.',
    '.NnNnnnnnnnNN.',
    '.YYYYYYYYYYYY.',
    '.NNNNNNNNNNNN.',
  ]],
  grave: [[
    '...LLLLLL...',
    '..LBBBBBBb..',
    '.LBBBkBBBBb.',
    '.LBBkkkBBBb.',
    '.LBBBkBBBBb.',
    '.LBBBkBBBBb.',
    '.LBBBBBBBBb.',
    '.LBBBBBBBBb.',
    '.LBBBBBBBBb.',
    'lfLBBBBBBbFl',
    '.lfffffffFF.',
  ]],
  sword: [[
    '........gw',
    '.......gwg',
    '......gwg.',
    '.....gwg..',
    '....gwg...',
    '.y.gwg....',
    '..yyg.....',
    '..nyy.....',
    '.n..y.....',
    'n.........',
  ]],
  armor: [[
    '.gg....gg.',
    'gwgg..ggGg',
    'gwggggggGg',
    '.gwgggggG.',
    '.gwgyyggG.',
    '.ggggggGG.',
    '.gggggGGG.',
    '..GGGGGG..',
  ]],
  amulet: [[
    '..y....y..',
    '...y..y...',
    '....yy....',
    '...yccy...',
    '..ycwccy..',
    '..yccccy..',
    '...yccy...',
    '....yy....',
  ]],
  quiver: [[
    '...w.w.w..',
    '...n.n.n..',
    '..NnnnnnN.',
    '..NnnnnnN.',
    '..NnyynnN.',
    '..NnnnnnN.',
    '..NnnnnnN.',
    '...NNNNN..',
  ]],
  fire: [[
    '.....o......',
    '....oyo.....',
    '....oyyo....',
    '...oyywyo...',
    '...orywyro..',
    '...rooooor..',
    '.nNnNnnNnNn.',
    '..NnnNNnnN..',
  ], [
    '......o.....',
    '.....oyo....',
    '....oyyo....',
    '...oyywyo...',
    '...orywyyo..',
    '...rooooor..',
    '.nNnNnnNnNn.',
    '..NnnNNnnN..',
  ]],
  tent: [[
    '.......k........',
    '.......BL.......',
    '......BBLL......',
    '......BBLL......',
    '.....BBBLLL.....',
    '.....BBBLLL.....',
    '....BBBBLLLL....',
    '....BBBkkLLL....',
    '...BBBkkkkLLL...',
    '...BBBkkkkLLL...',
    '..BBBBkkkkLLLL..',
    '..bbbbkkkkbbbb..',
  ]],
  bone: [[
    'w.....w.',
    '.wwwwww.',
    'w.....w.',
  ]],
  well: [[
    '...GGGGGG...',
    '.GGgggggGGG.',
    'GgccccccccgG',
    'GgcwccccccgG',
    'GgccccccccgG',
    '.GGgggggGGG.',
    '.GDGGGGGGDG.',
    '.GGDGGGGDGG.',
    '..DDDDDDDD..',
  ]],
  stall: [[
    'BwBwBwBwBwBwBw',
    'BwBwBwBwBwBwBw',
    'BwBwBwBwBwBwBw',
    'bbbbbbbbbbbbbb',
    '.n..........n.',
    '.nyrlyrlyrlyn.',
    '.NNNNNNNNNNNN.',
    '.n..........n.',
    '.n..........n.',
  ]],
  tower: [disc(20, tower)],
  turret: [disc(16, tower)],
  fountain: [disc(24, (d, edge, x, y) => {
    if (edge) return 'G';
    if (d > 0.76) return (x + y) % 3 ? 'g' : 'G'; // the stone rim
    if (d < 0.2) return 'w'; // the jet
    return (x * 3 + y * 5) % 13 === 0 ? 'w' : 'c';
  }), disc(24, (d, edge, x, y) => {
    if (edge) return 'G';
    if (d > 0.76) return (x + y) % 3 ? 'g' : 'G';
    if (d < 0.26) return 'w';
    return (x * 5 + y * 3) % 13 === 0 ? 'w' : 'c';
  })],
  arch: [arch(32, 26)],
  cave: [cave(28, 22)],
  cave_sealed: [cave(28, 22).map((r, y) => r.replace(/k/g, (_, x) => ((x + y) % 3 ? 'G' : 'D')))], // the mouth filled with rubble
};

// ---------------------------------------------------------------------------- views from every side

export const VIEW_NAMES = ['s', 'se', 'e', 'ne', 'n'];
// One pose walks in four frames: standing, one foot up, standing, the other foot up.
function walkCycle(rows) {
  return [rows, liftFoot(rows, 0), rows, liftFoot(rows, 1)];
}
// The bottom of one half of the sprite (a leg) drawn a pixel higher: that foot leaves the ground.
function liftFoot(rows, side) {
  const h = rows.length;
  const w = rows[0].length;
  const zone = Math.max(2, Math.round(h * 0.2));
  return rows.map((row, y) => {
    if (y < h - zone) return row;
    return [...row].map((ch, x) => ((x < w / 2) === (side === 0) ? (rows[y + 1]?.[x] ?? '.') : ch)).join('');
  });
}
for (const [name, views] of Object.entries(VIEW_DATA)) {
  for (const v of VIEW_NAMES) if (views[v]) SPRITES[`${name}.${v}`] = walkCycle(views[v]);
}

// Which view to draw for someone facing (fx, fy) on screen (y grows down), and whether to mirror it.
const OCTANTS = [['e', false], ['se', false], ['s', false], ['se', true], ['e', true], ['ne', true], ['n', false], ['ne', false]];
export function viewOf(fx, fy) {
  const k = ((Math.round(Math.atan2(fy, fx) / (Math.PI / 4)) % 8) + 8) % 8;
  return OCTANTS[k];
}
// The sprite to draw for `name` facing (fx, fy): its view from that side if it has views, else itself, mirrored
// when it faces left (sprites without views look right).
export function pose(name, fx = 0, fy = 1) {
  if (SPRITES[name + '.s']) {
    const [v, flip] = viewOf(fx, fy);
    return { name: `${name}.${v}`, flip };
  }
  return { name, flip: fx < 0 };
}

// A round shape drawn by a rule: fill(distance from the centre 0..1, is it the rim, x, y) gives the letter.
function disc(n, fill) {
  const rows = [];
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / (n / 2);
      row += d > 1 ? '.' : fill(d, d > 0.86, x, y);
    }
    rows.push(row);
  }
  return rows;
}

// A round tower seen from above: battlements on the rim, a dark walk inside them, the stone roof.
function tower(d, edge, x, y) {
  if (edge) return (x + y) % 2 ? 'G' : 'g';
  if (d > 0.74) return 'D';
  return (x * 7 + y * 3) % 11 === 0 ? 'G' : 'g';
}

// The stone front of a dungeon: blocks of masonry around a dark round-topped door.
function arch(W, H) {
  const rows = [];
  const top = Math.round(H * 0.4); // where the door stops being round
  const r = W * 0.2;
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const dx = x - (W - 1) / 2;
      const door = y >= top ? Math.abs(dx) < r : Math.hypot(dx, (y - top) * 1.2) < r;
      if (door) row += y > H - 3 ? 'D' : 'k';
      else if (Math.hypot(dx, (y - top) * 1.2) < r + 2 && y <= top) row += 'g'; // the arch stones
      else if (Math.abs(dx) < r + 2 && Math.abs(dx) >= r && y > top) row += 'g';
      else if (y === 0 || x === 0 || x === W - 1) row += 'D';
      else if (y % 4 === 3) row += 'D'; // mortar between courses
      else if ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0) row += 'D';
      else row += y % 4 === 0 ? 'g' : 'G';
    }
    rows.push(row);
  }
  return rows;
}

// A heap of rock with a dark mouth at its foot.
function cave(W, H) {
  const rows = [];
  for (let y = 0; y < H; y++) {
    let row = '';
    for (let x = 0; x < W; x++) {
      const dx = (x - (W - 1) / 2) / (W / 2);
      const dy = (y - H * 0.55) / (H * 0.55);
      if (dx * dx + dy * dy > 1) { row += '.'; continue; }
      const hole = Math.hypot((x - (W - 1) / 2) / (W * 0.25), (y - (H - 1)) / (H * 0.45)) < 1;
      if (hole) row += 'k';
      else if (dy < -0.55) row += 'g';
      else row += (x * 5 + y * 7) % 9 === 0 ? 'D' : dx > 0.35 || dy > 0.6 ? 'D' : 'G';
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------- colours

function parseHex(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// k < 1 darkens, k > 1 lightens towards white.
export function shade(hex, k) {
  const rgb = parseHex(hex);
  return toHex(k <= 1 ? rgb.map((v) => v * k) : rgb.map((v) => v + (255 - v) * (k - 1)));
}

// The colour of every letter for one drawing: the palette, with the slots filled in (null leaves a letter out).
export function colorsFor(slots = {}) {
  const s = { ...SLOTS, ...slots };
  const out = { ...PAL, B: s.B, T: s.T, h: s.h, A: s.A, O: s.O };
  out.b = s.b ?? (s.B && shade(s.B, 0.68));
  out.L = s.L ?? (s.B && shade(s.B, 1.35));
  out.t = s.t ?? (s.T && shade(s.T, 0.7));
  return out;
}

// One frame as RGBA pixels, one pixel of outline added on every side. flash paints it all one colour (true: white,
// the flash of a hit; a colour: a silhouette).
export function spritePixels(name, frame = 0, slots = {}, flash = false) {
  const frames = SPRITES[name];
  if (!frames) throw new Error('no sprite ' + name);
  const rows = frames[frame % frames.length];
  const h = rows.length;
  const w = rows[0].length;
  const W = w + 2;
  const H = h + 2;
  const data = new Uint8ClampedArray(W * H * 4);
  const colors = colorsFor(slots);
  const solid = new Uint8Array(W * H);
  const rgbOf = {};
  const flat = flash === true ? [255, 255, 255] : flash ? parseHex(flash) : null;
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`sprite ${name} frame ${frame}: row ${y} is ${rows[y].length} wide, not ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      if (!(ch in colors)) throw new Error(`sprite ${name}: unknown letter ${ch}`);
      const hex = colors[ch];
      if (!hex) continue; // a slot left empty
      const rgb = flat ?? (rgbOf[hex] ??= parseHex(hex));
      const i = ((y + 1) * W + x + 1) * 4;
      data.set([...rgb, 255], i);
      solid[(y + 1) * W + x + 1] = 1;
    }
  }
  const outline = parseHex(colors.O);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (solid[y * W + x]) continue;
      const near = (dx, dy) => x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && solid[(y + dy) * W + x + dx];
      if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) data.set([...outline, 255], (y * W + x) * 4);
    }
  }
  return { w: W, h: H, data };
}

export const frameCount = (name) => SPRITES[name]?.length ?? 0;
export const hasSprite = (name) => name in SPRITES;
// The size of a frame with its outline, in sprite pixels.
export function spriteSize(name) {
  const rows = SPRITES[name][0];
  return { w: rows[0].length + 2, h: rows.length + 2 };
}

// ---------------------------------------------------------------------------- drawing

const cache = new Map();
function spriteCanvas(name, frame, slots, flash) {
  const key = `${name}|${frame}|${flash}|${slots.B}|${slots.T}|${slots.h}|${slots.A}|${slots.O}|${slots.L}|${slots.b}`;
  let c = cache.get(key);
  if (c) return c;
  const px = spritePixels(name, frame, slots, flash);
  if (typeof document === 'undefined') return { width: px.w, height: px.h, none: true }; // no page (tests): measure only
  c = document.createElement('canvas');
  c.width = px.w;
  c.height = px.h;
  const g = c.getContext('2d');
  const img = g.createImageData(px.w, px.h);
  img.data.set(px.data);
  g.putImageData(img, 0, 0);
  cache.set(key, c);
  return c;
}

// Draws a sprite centred on (x, y), `scale` screen pixels to a sprite pixel. flip mirrors it (sprites look right).
export function drawSprite(ctx, name, x, y, { frame = 0, scale = 2, flip = false, slots = {}, flash = false, anchor = 'center' } = {}) {
  const c = spriteCanvas(name, frame % frameCount(name), slots, flash);
  const w = c.width * scale;
  const h = c.height * scale;
  const left = Math.round(x - w / 2);
  const top = Math.round(anchor === 'bottom' ? y - h : y - h / 2);
  if (c.none) return { left, top, w, h };
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.save();
    ctx.translate(left + w, top);
    ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(c, left, top, w, h);
  }
  ctx.imageSmoothingEnabled = smooth;
  return { left, top, w, h };
}

// ---------------------------------------------------------------------------- monsters

// Which sprite a monster or a boss wears; its own colour fills the body.
const ENEMY_LOOKS = {
  slime: 'slime', wolf: 'wolf', scorpion: 'scorpion', goblin: 'goblin', archer: 'skeleton', boar: 'boar', golem: 'golem',
  mage: 'mage', troll: 'troll', bat: 'bat', harpy: 'harpy', wyvern: 'wyvern',
  slime_king: 'slime', alpha_wolf: 'wolf', sand_tyrant: 'scorpion', frost_giant: 'troll', bone_lord: 'skeleton',
  ice_warden: 'golem', tomb_king: 'skeleton', ring_keeper: 'golem',
};
// Where a crown sits on a sprite: the middle of its topmost row, in sprite pixels (outline not counted).
function crownSpot(name, frame) {
  const rows = SPRITES[name][frame % SPRITES[name].length];
  const y = rows.findIndex((r) => /[^.]/.test(r));
  const xs = [...rows[y]].map((c, x) => (c === '.' ? -1 : x)).filter((x) => x >= 0);
  return [(xs[0] + xs[xs.length - 1] + 1) / 2, y];
}

export function enemyLook(def) {
  const name = ENEMY_LOOKS[def.id];
  if (!name) return null;
  return {
    name,
    crown: /king|lord/.test(def.id), // kings and lords wear a crown
    slots: { B: def.color, A: def.id === 'archer' ? PAL.n : null }, // only the archer carries a bow
  };
}

// How many screen pixels to a sprite pixel for a monster of radius r: about as wide as its body, never blurry.
export function enemyScale(def, r = def.r) {
  const look = enemyLook(def);
  return look ? Math.max(2, Math.round((2.2 * r) / SPRITES[look.name][0][0].length)) : 2;
}

// Draws a monster centred on (x, y); false when it has no sprite (draw something else then).
// (fx, fy): where it faces, for monsters seen from every side; the others only turn left or right.
export function drawEnemySprite(ctx, def, x, y, { scale = enemyScale(def), frame = 0, fx = 1, fy = 0, flash = false, outline } = {}) {
  const look = enemyLook(def);
  if (!look) return false;
  const { name, flip } = pose(look.name, fx, fy);
  const slots = outline ? { ...look.slots, O: outline } : look.slots;
  const box = drawSprite(ctx, name, x, y, { scale, frame, flip, flash, slots });
  if (look.crown) {
    const [cx, cy] = crownSpot(name, frame);
    const px = flip ? box.left + box.w - (cx + 1) * scale : box.left + (cx + 1) * scale;
    drawSprite(ctx, 'crown', px, box.top + (cy + 2) * scale, { scale, anchor: 'bottom', flash });
  }
  return box;
}

// The biggest scale (in half steps) at which a monster fits in a box px wide and high, for pictures in windows.
export function enemyFitScale(def, px) {
  const look = enemyLook(def);
  if (!look) return 0;
  const { w, h } = spriteSize(look.name);
  return Math.max(1, Math.floor((2 * px) / Math.max(w, h)) / 2);
}
