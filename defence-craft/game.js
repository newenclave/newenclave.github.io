'use strict';
(() => {
const W = 360, H = 520, DT = 1 / 60, TAU = Math.PI * 2;
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- save ---------------- */
const SAVE_KEY = 'td_save_v2';
function freshSave() {
  return { gems: 0, unlocked: { gun: 1 }, seen: {}, up: { gold: 0, dmg: 0, life: 0, inc: 0, luck: 0, arm: 0, reg: 0, cmd: 0 }, tech: {}, best: {}, levels: {}, speed: 1, tier: 1, abil: {} };
}
function loadSave() {
  const s = freshSave();
  try {
    const r = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (r) { s.gems = r.gems | 0; Object.assign(s.unlocked, r.unlocked); Object.assign(s.seen, r.seen); Object.assign(s.up, r.up); Object.assign(s.tech, r.tech); Object.assign(s.best, r.best); Object.assign(s.levels, r.levels); s.speed = clamp(r.speed | 0, 1, 3); s.tier = clamp(r.tier | 0, 1, 10); Object.assign(s.abil, r.abil); }
  } catch (e) { /* no storage */ }
  return s;
}
let save = loadSave();
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }

/* ---------------- grids ---------------- */
function pip(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function newGrid(unit, cr) {
  const g = { cells: [], map: new Map(), unit, cr };
  g.add = (c, r, cx, cy, poly) => {
    const cell = { id: g.cells.length, c, r, cx, cy, poly, nb: [], path: false, tower: null };
    g.cells.push(cell); g.map.set(c + ',' + r, cell);
  };
  g.at = (c, r) => g.map.get(c + ',' + r);
  g.link = nbOf => { for (const cell of g.cells) cell.nb = nbOf(cell.c, cell.r).map(([c, r]) => g.at(c, r)).filter(Boolean); };
  g.cellAt = (x, y) => g.cells.find(cell => pip(x, y, cell.poly)) || null;
  return g;
}
function makeSquare(s = 40) {
  const cols = Math.floor(W / s), rows = Math.floor(H / s), yoff = (H - rows * s) / 2, g = newGrid(40, s * 0.35);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const y0 = yoff + r * s;
    g.add(c, r, c * s + s / 2, y0 + s / 2, [[c * s, y0], [(c + 1) * s, y0], [(c + 1) * s, y0 + s], [c * s, y0 + s]]);
  }
  g.link((c, r) => [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]);
  return g;
}
function makeHex() {
  const cols = 7, rows = 11, w = W / (cols + 0.5), s = w / Math.sqrt(3), total = 1.5 * s * (rows - 1) + 2 * s, yoff = (H - total) / 2;
  const g = newGrid(w, 15);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = w / 2 + c * w + (r % 2 ? w / 2 : 0), cy = yoff + s + r * 1.5 * s, poly = [];
    for (let i = 0; i < 6; i++) { const a = (60 * i - 30) * Math.PI / 180; poly.push([cx + s * Math.cos(a), cy + s * Math.sin(a)]); }
    g.add(c, r, cx, cy, poly);
  }
  g.link((c, r) => r % 2 === 0
    ? [[c - 1, r], [c + 1, r], [c - 1, r - 1], [c, r - 1], [c - 1, r + 1], [c, r + 1]]
    : [[c - 1, r], [c + 1, r], [c, r - 1], [c + 1, r - 1], [c, r + 1], [c + 1, r + 1]]);
  return g;
}
function makeTri() {
  const n = 14, rows = 11, a = 2 * W / (n + 1), h = a * Math.sqrt(3) / 2, yoff = (H - rows * h) / 2;
  const g = newGrid(h, 10);
  for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
    const x0 = c * a / 2, y0 = yoff + r * h, up = (c + r) % 2 === 0;
    g.add(c, r, x0 + a / 2, y0 + (up ? 2 * h / 3 : h / 3), up
      ? [[x0 + a / 2, y0], [x0 + a, y0 + h], [x0, y0 + h]]
      : [[x0, y0], [x0 + a, y0], [x0 + a / 2, y0 + h]]);
  }
  g.link((c, r) => [[c - 1, r], [c + 1, r], (c + r) % 2 === 0 ? [c, r + 1] : [c, r - 1]]);
  return g;
}

const LEVELS = [
  { id: 'sq', name: 'Squares', make: makeSquare, diff: 1,
    wps: [[0, 0], [7, 0], [7, 2], [1, 2], [1, 4], [7, 4], [7, 6], [1, 6], [1, 8], [7, 8], [7, 10], [1, 10], [1, 12], [8, 12]] },
  { id: 'hex', name: 'Hexagons', make: makeHex, diff: 1.15,
    wps: [[0, 1], [5, 1], [5, 3], [1, 3], [1, 5], [5, 5], [5, 7], [1, 7], [1, 9], [6, 9]] },
  { id: 'tri', name: 'Triangles', make: makeTri, diff: 1.3,
    wps: [[0, 1], [12, 1], [12, 3], [1, 3], [1, 5], [12, 5], [12, 7], [1, 7], [1, 9], [13, 9]] },
  { id: 'sqs', name: 'Square Spiral', make: makeSquare, diff: 1.2, cost: 40,
    wps: [[0, 0], [8, 0], [8, 12], [0, 12], [0, 2], [2, 2], [2, 10], [6, 10], [6, 2], [4, 2], [4, 8]] },
  { id: 'hxs', name: 'Hex Spiral', make: makeHex, diff: 1.35, cost: 100,
    wps: [[0, 0], [6, 0], [6, 10], [0, 10], [0, 2], [4, 2], [4, 8], [2, 8], [2, 4]] },
  { id: 'fort', name: 'Fortress', make: () => makeSquare(30), diff: 1.1, cost: 80, desc: '4 arms, small cells, base turret', turret: true, speed: 0.33,
    arms: [
      [[3, 0], [3, 3], [6, 3], [6, 8]],
      [[8, 16], [8, 13], [6, 13], [6, 8]],
      [[0, 11], [3, 11], [3, 8], [6, 8]],
      [[11, 5], [8, 5], [8, 8], [6, 8]],
    ] },
];

function buildPath(grid, wps, used) {
  const seq = [];
  let cur = grid.at(...wps[0]);
  seq.push(cur); used.add(cur.id);
  for (let i = 1; i < wps.length; i++) {
    const target = grid.at(...wps[i]);
    const prev = new Map([[cur.id, null]]), q = [cur];
    for (let qi = 0; qi < q.length && !prev.has(target.id); qi++) {
      for (const nb of q[qi].nb) {
        if (prev.has(nb.id) || (used.has(nb.id) && nb !== target)) continue;
        prev.set(nb.id, q[qi]); q.push(nb);
      }
    }
    if (!prev.has(target.id)) throw new Error('path: no route to waypoint ' + i);
    const seg = [];
    for (let c = target; c !== cur; c = prev.get(c.id)) seg.push(c);
    seg.reverse();
    for (const c of seg) { seq.push(c); used.add(c.id); }
    cur = target;
  }
  seq.forEach(c => { c.path = true; });
  const f = seq[0], ds = [f.cx, W - f.cx, f.cy, H - f.cy], m = ds.indexOf(Math.min(...ds));
  const entry = [{ x: -20, y: f.cy }, { x: W + 20, y: f.cy }, { x: f.cx, y: -20 }, { x: f.cx, y: H + 20 }][m];
  const pts = [entry, ...seq.map(c => ({ x: c.cx, y: c.cy }))];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const end = pts[pts.length - 1];
  return { seq, pts, cum, len: cum[cum.length - 1], fly: Math.hypot(end.x - entry.x, end.y - entry.y) };
}
function buildPaths(grid, L) {
  const arms = L.arms || [L.wps], used = new Set();
  const base = grid.at(...arms[0][arms[0].length - 1]);
  const paths = arms.map(wps => buildPath(grid, wps, used));
  base.base = true;
  return { paths, base };
}
function posAt(path, d) {
  const { pts, cum } = path;
  if (d <= 0) return pts[0];
  if (d >= path.len) return pts[pts.length - 1];
  let i = 1;
  while (cum[i] < d) i++;
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
}

/* ---------------- definitions ---------------- */
const TD = {
  gun:    { name: 'Gun',    cmd: 1, cost: 50,  dmg: 9,  rate: 2.2, range: 2.7, kind: 'bullet', col: '#4da8da', shape: 0, barrel: 1, at: 0, gems: 0,   desc: 'Cheap all-rounder' },
  rapid:  { name: 'Rapid',  cmd: 2, cost: 90,  dmg: 4,  rate: 8,   range: 2.3, kind: 'bullet', col: '#f4d35e', shape: 3, barrel: 1, at: 10, gems: 15,   desc: 'Very fast, weak vs armor' },
  cannon: { name: 'Cannon', cmd: 2, cost: 130, dmg: 34, rate: 0.75, range: 2.9, kind: 'bullet', col: '#e07a5f', shape: 4, rot: Math.PI / 4, barrel: 1, splash: 0.9, ground: true, at: 13, gems: 25, desc: 'Splash damage, ground only' },
  frost:  { name: 'Frost',  cmd: 1, cost: 110, dmg: 3,  rate: 1.6, range: 2.5, kind: 'bullet', col: '#9bf6ff', shape: 6, slow: 0.45, slowT: 2, at: 16, gems: 40, desc: 'Slows enemies' },
  flame:  { name: 'Flame',  cmd: 2, cost: 170, dmg: 3.5, rate: 10, range: 1.7, kind: 'flame',  col: '#ff6b35', shape: 5, ground: true, at: 20, gems: 70, desc: 'Burns ground groups' },
  sniper: { name: 'Sniper', cmd: 3, cost: 220, dmg: 80, rate: 0.45, range: 6.5, kind: 'beam',  col: '#cdb4db', shape: 'dia', barrel: 1, crit: 0.25, at: 25, gems: 100, desc: 'Huge range, crits' },
  tesla:  { name: 'Tesla',  cmd: 3, cost: 240, dmg: 16, rate: 1.2, range: 2.7, kind: 'chain',  col: '#ffee58', shape: 'star', chain: 4, at: 30, gems: 150, desc: 'Chain lightning' },
};
TD.core = { name: 'Core', cost: 0, dmg: 10, rate: 2, range: 3.2, kind: 'bullet', col: '#cfd8dc', shape: 6, barrel: 1, desc: 'Your base turret' };
// A tower is Unknown until its wave (`at`) is reached, then Discovered (buyable for `gems`), then Owned (in the shop).
const TORDER = Object.keys(TD).filter(k => k !== 'core');
const EN = {
  grunt:    { dmg: 4, hp: 30,  spd: 42, rew: 3,  r: 9,  col: '#7bd36b', armor: 0, shape: 0 },
  runner:   { dmg: 3, hp: 18,  spd: 80, rew: 3,  r: 7,  col: '#f4d35e', armor: 0, shape: 3 },
  tank:     { dmg: 10, hp: 140, spd: 28, rew: 9,  r: 12, col: '#8d99ae', armor: 3, shape: 4, rot: Math.PI / 4 },
  swarm:    { dmg: 1.5, hp: 8,   spd: 55, rew: 1,  r: 5,  col: '#c77dff', armor: 0, shape: 0 },
  flyer:    { dmg: 5, hp: 40,  spd: 50, rew: 6,  r: 8,  col: '#4cc9f0', armor: 0, shape: 4, fly: true },
  splitter: { dmg: 6, hp: 70,  spd: 38, rew: 6,  r: 11, col: '#ff9f1c', armor: 0, shape: 6, split: 3 },
  mini:     { dmg: 2, hp: 14,  spd: 55, rew: 1,  r: 6,  col: '#ff9f1c', armor: 0, shape: 6 },
  elite:    { dmg: 10, hp: 220, spd: 30, rew: 25, r: 13, col: '#fff', armor: 1, shape: 5, elite: true },
  boss2:    { dmg: 35, hp: 380, spd: 24, rew: 90, r: 15, col: '#c77dff', armor: 1, shape: 8, boss: true, spawner: true },
  boss3:    { dmg: 35, hp: 450, spd: 22, rew: 90, r: 16, col: '#2ec4b6', armor: 2, shape: 8, boss: true, regen: 0.02 },
  boss:     { dmg: 35, hp: 550, spd: 22, rew: 80, r: 16, col: '#e63946', armor: 3, shape: 8, boss: true },
};
const UP = {
  gold: { name: 'Start gold', desc: '+40 gold per level', max: 10, cost: l => Math.round(20 * Math.pow(l + 1, 1.6)) },
  dmg:  { name: 'Damage',     desc: '+5% damage per level', max: 20, cost: l => Math.round(30 * Math.pow(l + 1, 1.6)) },
  life: { name: 'Base HP',    desc: 'Base HP track starts +1 level', max: 10, cost: l => Math.round(40 * Math.pow(l + 1, 1.6)) },
  arm:  { name: 'Base armor', desc: 'Armor track starts +1 level (-10% damage taken)', max: 8, cost: l => Math.round(35 * Math.pow(l + 1, 1.6)) },
  cmd:  { name: 'Command',    desc: 'Command level starts +1 (+2 command points)', max: 8, cost: l => Math.round(30 * Math.pow(l + 1, 1.6)) },
  reg:  { name: 'Base regen', desc: 'Regen track starts +1 level (+0.5 HP/s)', max: 8, cost: l => Math.round(30 * Math.pow(l + 1, 1.6)) },
  inc:  { name: 'Kill gold',  desc: '+5% gold per level', max: 10, cost: l => Math.round(30 * Math.pow(l + 1, 1.6)) },
  luck: { name: 'Elite luck', desc: '+2% elite chance per level', max: 10, cost: l => Math.round(25 * Math.pow(l + 1, 1.6)) },
};

const ABIL = {
  nova:   { name: 'Nova',      desc: 'Hits every enemy for 15% max HP (5% for bosses)', cd: 45, cost: 30 },
  freeze: { name: 'Freeze',    desc: 'Slows all enemies for 4 s',                         cd: 40, cost: 50 },
  rain:   { name: 'Gold rain', desc: 'Kill gold x3 for 10 s',                             cd: 60, cost: 80 },
};
const AORDER = ['nova', 'freeze', 'rain'];
const MAXTIER = 10;
// Elite enemies: rare, tough, carry a prize. Chance per wave = base + perWave * wave + luck bonus.
// pity: +chance for every wave without an elite, and a sure spawn after 'guarantee' dry waves.
const ELITE = { from: 3, base: 0.05, perWave: 0.005, max: 0.25, luck: 0.02, pity: 0.025, guarantee: 10 };
const LOOT = {
  perk: { w: 0.5, col: '#c77dff', label: 'Perk' },
  gold: { w: 0.3, col: '#ffd166', label: 'Gold' },
  gems: { w: 0.2, col: '#4cc9f0', label: 'Gems' },
};
const eliteChance = (w, dry = 0) => (w < ELITE.from ? 0 : dry >= ELITE.guarantee ? 1 : Math.min(0.9, Math.min(ELITE.max, ELITE.base + ELITE.perWave * w + ELITE.luck * save.up.luck) + ELITE.pity * dry));
function rollLoot() {
  let r = Math.random();
  for (const k in LOOT) { if ((r -= LOOT[k].w) < 0) return k; }
  return 'perk';
}

/* ---------------- game state ---------------- */
let G = null, menuLevel = 0, menuTier = 1, acc = 0, last = 0;
const levelOpen = i => !LEVELS[i].cost || !!save.levels[LEVELS[i].id];

function startGame(li, tier = 1) {
  const L = LEVELS[li], grid = L.make(), { paths, base } = buildPaths(grid, L);
  G = {
    li, L, grid, paths, base, tier, armMul: 1 + 0.25 * (paths.length - 1), cds: { nova: 0, freeze: 0, rain: 0 }, goldT: 0,
    gold: 100 + 30 * save.up.gold, b: { hp: save.up.life, arm: save.up.arm, reg: save.up.reg, cmd: save.up.cmd }, bu: { hp: 0, arm: 0, reg: 0, cmd: 0 }, hp: 0, selBase: false, wave: 0, time: 0,
    towers: [], enemies: [], projs: [], fx: [], parts: [], floats: [], spawns: [],
    waveActive: false, autoT: 0, lastGo: -9, kills: 0, bossKills: 0, runGems: 0,
    mods: { dmg: 1, rate: 1, range: 1, gold: 1, speed: 1, cost: 1, upc: 1, cmd: 0 }, perkQ: 0, eliteDry: 0, newTowers: [], offer: null,
    speed: 1, paused: false, auto: false, sel: null, armed: null, hover: null, hurt: 0, over: false,
  };
  G.hp = baseMax();
  acc = 0; infoSig = ''; $('ov').style.display = 'none';
  if (L.turret) {
    const t = { type: 'core', cell: base, x: base.cx, y: base.cy, up: { dmg: 0, rate: 0, rng: 0 }, cd: 0, ang: -Math.PI / 2, mode: 0, spent: 0, isBase: true, id: 'core' };
    base.tower = t; G.towers.push(t);
  }
  buildShop(); buildAbil(); updateButtons();
}

const goldMul = () => 1 + 0.05 * save.up.inc;
const techLv = type => save.tech[type] || 0;
const TRACKS = {
  dmg:  { label: 'Dmg', k: 0.6,  g: 1.45 },
  rate: { label: 'Spd', k: 0.6,  g: 1.45 },
  rng:  { label: 'Rng', k: 0.45, g: 1.5, max: 10 },
};
const BTRACKS = {
  hp:  { label: 'HP',    k: 40, g: 1.4 },
  arm: { label: 'Armor', k: 50, g: 1.5 },
  reg: { label: 'Regen', k: 45, g: 1.45 },
  cmd: { label: 'Cmd',   k: 60, g: 1.55 },
};
const lvlOf = t => 1 + t.up.dmg + t.up.rate + t.up.rng;
const dmgOf = t => TD[t.type].dmg * Math.pow(1.35, t.up.dmg) * (1 + 0.05 * save.up.dmg + 0.12 * techLv(t.type)) * G.mods.dmg;
const rateOf = t => TD[t.type].rate * Math.pow(1.15, t.up.rate) * (1 + 0.04 * techLv(t.type)) * G.mods.rate;
const rangeOf = t => (TD[t.type].range + 0.15 * t.up.rng) * G.grid.unit * G.mods.range;
const trackCost = (t, k) => {
  const T = TRACKS[k], n = t.up[k];
  return T.max && n >= T.max ? Infinity : Math.round((TD[t.type].cost || 60) * T.k * Math.pow(T.g, n) * G.mods.upc);
};
const baseCost = k => Math.round(BTRACKS[k].k * Math.pow(BTRACKS[k].g, G.bu[k]) * G.mods.upc);
const baseMax = () => 50 + 20 * G.b.hp;
const armF = () => Math.pow(0.9, G.b.arm);
const regenOf = () => 0.5 * G.b.reg;
// Command points: every tower occupies some of the base's limited command capacity.
const CMD_BASE = 8;
const cmdCap = () => CMD_BASE + 2 * G.b.cmd + G.mods.cmd;
const cmdUsed = () => G.towers.reduce((a, t) => a + (t.isBase ? 0 : TD[t.type].cmd), 0);
function canBuild(type) {
  if (G.gold < costOf(type)) return 'Need gold';
  if (cmdUsed() + TD[type].cmd > cmdCap()) return 'No command points';
  return '';
}
const costOf = type => Math.round(TD[type].cost * G.mods.cost);
const hpMul = w => Math.pow(1.27, w - 1) * G.L.diff * (1 + 0.6 * (G.tier - 1));

function genWave(w) {
  const q = [], add = (type, n, gap, start, fixed) => {
    const k = fixed ? n : Math.max(1, Math.round(n * G.armMul)), g = fixed ? gap : gap / G.armMul;
    for (let i = 0; i < k; i++) q.push({ t: start + i * g, type });
  };
  add('grunt', 5 + w, Math.max(0.35, 0.9 - w * 0.02), 0.3);
  if (w >= 2 && w % 2 === 0) add('runner', 3 + (w >> 1), 0.5, 2);
  if (w >= 4 && w % 3 === 1) add('swarm', 10 + w, 0.18, 3);
  if (w >= 5 && w % 2 === 1) add('tank', 1 + Math.floor(w / 5), 1.8, 4);
  if (w >= 3 && w % 4 === 3) add('flyer', 2 + (w >> 2), 1.0, 2);
  if (w >= 6 && w % 3 === 0) add('splitter', 2 + Math.floor(w / 6), 1.6, 3);
  if (w % 10 === 0) add(['boss', 'boss2', 'boss3'][(w / 10 - 1) % 3], 1, 1, 6, true);
  return q;
}
const isSeen = type => !!(save.seen[type] || save.unlocked[type]);
function checkUnlocks() {
  let any = false;
  for (const type of TORDER) {
    const D = TD[type];
    if (isSeen(type) || !(D.at > 0) || G.wave < D.at) continue;
    save.seen[type] = 1; G.newTowers.push(D.name); any = true;
    floater(W / 2, 44 + 14 * (G.newTowers.length - 1), 'Discovered: ' + D.name, D.col);
  }
  if (any) persist();
}
function startWave() {
  if (!G || G.over || G.paused || G.spawns.length) return;
  if (G.enemies.length) { const b = 2 * G.wave; G.gold += b; floater(W / 2, H / 2 + 14, 'Early +' + b, '#ffd166'); } G.wave++; checkUnlocks(); G.waveActive = true; G.autoT = 0;
  for (const s of genWave(G.wave)) G.spawns.push({ t: G.time + s.t, type: s.type });
  if (G.wave >= ELITE.from) G.eliteDry++;
  if (Math.random() < eliteChance(G.wave, G.eliteDry - 1)) {
    G.eliteDry = 0;
    const loot = rollLoot();
    G.spawns.push({ t: G.time + 4, type: 'elite', loot });
    floater(W / 2, 24, 'Elite incoming: ' + LOOT[loot].label, LOOT[loot].col);
  }
  G.spawns.sort((a, b) => a.t - b.t);
}

function place(e) {
  if (e.fly) {
    const a = e.path.pts[0], b = e.path.pts[e.path.pts.length - 1], t = clamp(e.d / e.len, 0, 1);
    e.x = a.x + (b.x - a.x) * t; e.y = a.y + (b.y - a.y) * t;
  } else { const p = posAt(e.path, e.d); e.x = p.x; e.y = p.y; }
}
function spawnEnemy(type, d0 = 0, path = null, loot = null) {
  const S = EN[type], w = Math.max(1, G.wave);
  path = path || G.paths[Math.floor(Math.random() * G.paths.length)];
  const hp = S.hp * hpMul(w) * (S.boss ? 1 + w / 40 : 1);
  const e = {
    type, S, hp, max: hp, d: d0, spd: S.spd * G.grid.unit / 40 * G.mods.speed * (G.L.speed || 1), r: S.r, armor: S.armor * (1 + (S.boss ? w / 40 : w / 20)),
    fly: !!S.fly, path, loot, col: loot ? LOOT[loot].col : null, len: S.fly ? path.fly : path.len, x: 0, y: 0, slowT: 0, slowF: 1, burnT: 0, burnD: 0, flash: 0, dead: false,
    rew: Math.max(1, Math.round(S.rew * (1 + 0.04 * w))), dmg: S.dmg * (1 + 0.1 * (w - 1)),
  };
  place(e); G.enemies.push(e);
}

function floater(x, y, txt, col) { G.floats.push({ x, y, txt, col, t: 0.8 }); }
function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, v = 30 + Math.random() * 60;
    G.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.4, max: 0.4, col });
  }
}
function hurt(e, amt, raw) {
  if (e.dead) return;
  e.hp -= raw ? amt : Math.max(1, amt - e.armor);
  e.flash = 0.08;
  if (e.hp <= 0) kill(e);
}
// f = share of the prize: 1 when killed, 0.5 when the elite crashes into the base (a perk is still offered).
function dropLoot(e, f) {
  if (!e.loot) return;
  if (e.loot === 'perk') { if (G.offer) G.perkQ++; else offerPerks(); }
  else if (e.loot === 'gold') { const gg = Math.round((40 + 12 * G.wave) * f); G.gold += gg; floater(e.x, e.y - 22, '+' + gg + ' gold', LOOT.gold.col); }
  else if (e.loot === 'gems') { const n = Math.max(1, Math.round((2 + Math.floor(G.wave / 10)) * f)); G.runGems += n; floater(e.x, e.y - 22, '+' + n + ' gems', LOOT.gems.col); }
}
function kill(e) {
  e.dead = true; const gain = Math.max(1, Math.round(e.rew * goldMul() * G.mods.gold * (G.goldT > 0 ? 3 : 1))); G.gold += gain; G.kills++;
  floater(e.x, e.y - 8, '+' + gain, '#ffd166'); burst(e.x, e.y, e.S.col, e.S.boss ? 24 : 6);
  if (e.S.split) for (let i = 0; i < e.S.split; i++) spawnEnemy('mini', Math.max(0, e.d - i * 6), e.path);
  dropLoot(e, 1);
  if (e.S.boss) { G.bossKills++; G.runGems += 5; floater(e.x, e.y - 22, '+5 gems', '#9bf6ff'); }
}

/* ---------------- simulation ---------------- */
function findTarget(t) {
  const rng = rangeOf(t), D = TD[t.type];
  let best = null, bv = 0;
  for (const e of G.enemies) {
    if (e.dead || (D.ground && e.fly)) continue;
    const dx = e.x - t.x, dy = e.y - t.y, rr = rng + e.r;
    if (dx * dx + dy * dy > rr * rr) continue;
    const v = t.mode === 0 ? e.d / e.len : t.mode === 1 ? e.hp : -e.hp;
    if (!best || v > bv) { best = e; bv = v; }
  }
  return best;
}
function fire(t, tg) {
  const D = TD[t.type], dmg = dmgOf(t), u = G.grid.unit;
  t.ang = Math.atan2(tg.y - t.y, tg.x - t.x);
  if (D.kind === 'bullet') {
    G.projs.push({ x: t.x, y: t.y, tg, lx: tg.x, ly: tg.y, dmg, spd: 340, splash: (D.splash || 0) * u, slow: D.slow, slowT: D.slowT, col: D.col, ground: D.ground });
  } else if (D.kind === 'beam') {
    const crit = Math.random() < D.crit;
    hurt(tg, dmg * (crit ? 2.5 : 1), false);
    if (crit) floater(tg.x, tg.y - 12, 'CRIT', D.col);
    G.fx.push({ type: 'line', x1: t.x, y1: t.y, x2: tg.x, y2: tg.y, t: 0.15, max: 0.15, col: D.col, w: 2 });
  } else if (D.kind === 'chain') {
    const hit = new Set(); let cur = tg, px = t.x, py = t.y, d = dmg;
    for (let i = 0; i < D.chain && cur; i++) {
      hurt(cur, d, false); hit.add(cur);
      G.fx.push({ type: 'line', x1: px, y1: py, x2: cur.x, y2: cur.y, t: 0.12, max: 0.12, col: D.col, w: 2 });
      px = cur.x; py = cur.y; d *= 0.8;
      let nx = null, nd = 70;
      for (const e of G.enemies) {
        if (e.dead || hit.has(e)) continue;
        const dd = Math.hypot(e.x - px, e.y - py);
        if (dd < nd) { nd = dd; nx = e; }
      }
      cur = nx;
    }
  } else if (D.kind === 'flame') {
    for (const e of G.enemies) {
      if (e.dead || e.fly || Math.hypot(e.x - tg.x, e.y - tg.y) > 26) continue;
      hurt(e, dmg, false); e.burnT = 2; e.burnD = dmg * 2;
    }
    const a = t.ang;
    for (let i = 0; i < 2; i++) {
      const s = 90 + Math.random() * 60, sp = (Math.random() - 0.5) * 0.5;
      G.parts.push({ x: t.x, y: t.y, vx: Math.cos(a + sp) * s, vy: Math.sin(a + sp) * s, t: 0.3, max: 0.3, col: D.col });
    }
  }
}
function projHit(p) {
  const tg = p.tg;
  if (p.splash) {
    G.fx.push({ type: 'ring', x: p.x, y: p.y, r: p.splash, t: 0.25, max: 0.25, col: p.col });
    for (const e of G.enemies) {
      if (e.dead || (p.ground && e.fly)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) <= p.splash + e.r) hurt(e, p.dmg, false);
    }
  } else if (!tg.dead) {
    hurt(tg, p.dmg, false);
    if (p.slow) { const f = tg.S.boss ? 1 - (1 - p.slow) * 0.5 : p.slow; tg.slowF = Math.min(tg.slowF, f); tg.slowT = Math.max(tg.slowT, p.slowT); }
  }
  burst(p.x, p.y, p.col, 2);
}

function step(dt) {
  const g = G; g.time += dt;
  while (g.spawns.length && g.spawns[0].t <= g.time) { const sp = g.spawns.shift(); spawnEnemy(sp.type, 0, null, sp.loot); }

  for (const t of g.towers) {
    t.cd -= dt;
    if (t.cd > 0) continue;
    const tg = findTarget(t);
    if (!tg) continue;
    t.cd = 1 / rateOf(t); fire(t, tg);
  }
  for (const p of g.projs) {
    if (!p.tg.dead) { p.lx = p.tg.x; p.ly = p.tg.y; }
    const dx = p.lx - p.x, dy = p.ly - p.y, dist = Math.hypot(dx, dy), mv = p.spd * dt;
    if (dist <= mv + 2) { p.x = p.lx; p.y = p.ly; p.done = true; if (!p.tg.dead || p.splash) projHit(p); }
    else { p.x += dx / dist * mv; p.y += dy / dist * mv; }
  }
  g.projs = g.projs.filter(p => !p.done);

  for (const k of AORDER) g.cds[k] = Math.max(0, g.cds[k] - dt);
  g.goldT = Math.max(0, g.goldT - dt);
  for (const e of g.enemies.slice()) {
    if (e.dead) continue;
    if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 1; }
    if (e.burnT > 0) { e.burnT -= dt; hurt(e, e.burnD * dt, true); if (e.dead) continue; }
    e.flash -= dt;
    if (e.S.regen) e.hp = Math.min(e.max, e.hp + e.max * e.S.regen * dt);
    if (e.S.spawner && (e.sp = (e.sp || 0) - dt) <= 0) { e.sp = 3; spawnEnemy('mini', Math.max(0, e.d - 10), e.path); }
    e.d += e.spd * e.slowF * dt; place(e);
    if (e.d >= e.len) {
      e.dead = true; const hit = e.dmg * armF(); g.hp -= hit; g.hurt = 0.3; floater(g.base.cx, g.base.cy - 18, '-' + Math.ceil(hit), '#ff7b8a'); dropLoot(e, 0.5);
    }
  }
  g.enemies = g.enemies.filter(e => !e.dead);

  for (const f of g.fx) f.t -= dt;
  g.fx = g.fx.filter(f => f.t > 0);
  for (const p of g.parts) { p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  g.parts = g.parts.filter(p => p.t > 0);
  for (const f of g.floats) { f.t -= dt; f.y -= 20 * dt; }
  g.floats = g.floats.filter(f => f.t > 0);
  g.hurt = Math.max(0, g.hurt - dt);
  g.hp = Math.min(baseMax(), g.hp + regenOf() * dt);

  if (g.waveActive && !g.spawns.length && !g.enemies.length) {
    g.waveActive = false; g.autoT = 0;
    const b = 15 + 3 * g.wave;
    g.gold += b; floater(W / 2, H / 2, 'Wave clear +' + b, '#6bd36b');
  }
  if (g.auto && !g.waveActive && !g.spawns.length) { g.autoT += dt; if (g.autoT > 1.5) startWave(); }
  if (g.hp <= 0) endRun();
}

/* ---------------- perks ---------------- */
const PERKS = [
  { name: 'Overcharge',   desc: '+15% damage',              apply: m => { m.dmg *= 1.15; } },
  { name: 'Overclock',    desc: '+15% fire rate',           apply: m => { m.rate *= 1.15; } },
  { name: 'Scope',        desc: '+12% range',               apply: m => { m.range *= 1.12; } },
  { name: 'Prospector',   desc: '+20% kill gold',           apply: m => { m.gold *= 1.2; } },
  { name: 'Sticky floor', desc: 'Enemies 8% slower',        apply: m => { m.speed *= 0.92; } },
  { name: 'Bulk order',   desc: 'Towers cost 10% less',     apply: m => { m.cost *= 0.9; } },
  { name: 'Workshop',     desc: 'Upgrades cost 15% less',   apply: m => { m.upc *= 0.85; } },
  { name: 'Loot',         desc: 'Gold now (grows by wave)', apply: (m, g) => { g.gold += 100 + 15 * g.wave; } },
  { name: 'Reinforcements', desc: '+2 command points',     apply: m => { m.cmd += 2; } },
  { name: 'Repairs',      desc: 'Heal 50% of base HP',      apply: (m, g) => { g.hp = Math.min(baseMax(), g.hp + 0.5 * baseMax()); } },
];
function offerPerks() {
  const pool = PERKS.slice();
  G.offer = [];
  for (let i = 0; i < 3; i++) G.offer.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  G.paused = true; updateButtons();
  showOv('<h1>CHOOSE A PERK</h1><div class="sub">Elite defeated at wave ' + G.wave + '</div>' + G.offer.map((p, i) =>
    '<div class="row"><div class="t"><b>' + p.name + '</b><small>' + p.desc + '</small></div><button class="btn" data-act="perk" data-i="' + i + '">Take</button></div>').join(''));
}

/* ---------------- abilities ---------------- */
function useAbility(id) {
  if (!G || G.over || G.paused || !save.abil[id] || G.cds[id] > 0) return;
  const b = G.base;
  if (id === 'nova') {
    for (const e of G.enemies.slice()) hurt(e, e.max * (e.S.boss ? 0.05 : 0.15), true);
    for (let i = 0; i < 3; i++) G.fx.push({ type: 'ring', x: b.cx, y: b.cy, r: 90 + i * 70, t: 0.3 + i * 0.1, max: 0.3 + i * 0.1, col: '#ffffff' });
  } else if (id === 'freeze') {
    for (const e of G.enemies) { e.slowF = Math.min(e.slowF, e.S.boss ? 0.6 : 0.2); e.slowT = Math.max(e.slowT, 4); }
    G.fx.push({ type: 'ring', x: b.cx, y: b.cy, r: 200, t: 0.4, max: 0.4, col: '#9bf6ff' });
  } else if (id === 'rain') {
    G.goldT = 10; floater(W / 2, H / 2, 'Gold x3', '#ffd166');
  }
  G.cds[id] = ABIL[id].cd;
}

/* ---------------- actions ---------------- */
function build(cell, type) {
  const D = TD[type];
  if (!G || cell.path || cell.tower || canBuild(type)) return false;
  const t = { type, cell, x: cell.cx, y: cell.cy, up: { dmg: 0, rate: 0, rng: 0 }, cd: 0, ang: -Math.PI / 2, mode: 0, spent: costOf(type), id: G.towers.length + ':' + G.time };
  G.gold -= costOf(type); cell.tower = t; G.towers.push(t);
  burst(t.x, t.y, D.col, 6);
  return true;
}
function upgrade(t, k = 'dmg') {
  const c = trackCost(t, k);
  if (!isFinite(c) || G.gold < c) return false;
  G.gold -= c; t.spent += c; t.up[k]++;
  return true;
}
function upBase(k) {
  const c = baseCost(k);
  if (G.gold < c) return false;
  G.gold -= c; G.b[k]++; G.bu[k]++;
  if (k === 'hp') G.hp += 20;
  return true;
}
function sell(t) {
  if (t.isBase) return;
  G.gold += Math.floor(t.spent * 0.7);
  t.cell.tower = null; G.towers = G.towers.filter(x => x !== t); G.sel = null;
}
function endRun() {
  if (!G || G.over) return;
  G.over = true;
  const reached = Math.max(0, G.wave - 1);
  G.gemsEarned = Math.floor((Math.pow(reached, 1.4) * 0.8 * G.L.diff + G.runGems + G.kills / 25) * (1 + 0.25 * (G.tier - 1)));
  G.salvage = Math.floor((G.gold + G.towers.reduce((a, t) => a + t.spent, 0) * 0.5) / 60);
  G.gemsEarned += G.salvage;
  save.gems += G.gemsEarned;
  if (G.tier === save.tier && G.wave >= 15 && save.tier < MAXTIER) { save.tier++; G.tierUp = true; }
  save.best[G.L.id] = Math.max(save.best[G.L.id] || 0, G.wave);
  persist(); renderOver();
}

/* ---------------- drawing ---------------- */
function shapePath(c, x, y, r, k, rot = 0) {
  c.beginPath();
  if (k === 0) { c.arc(x, y, r, 0, TAU); return; }
  if (k === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r;
      i ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath(); return;
  }
  if (k === 'dia') { c.moveTo(x, y - r * 1.2); c.lineTo(x + r * 0.65, y); c.lineTo(x, y + r * 1.2); c.lineTo(x - r * 0.65, y); c.closePath(); return; }
  for (let i = 0; i < k; i++) {
    const a = rot - Math.PI / 2 + i * TAU / k;
    i ? c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath();
}
// Upgrades tint a unit: red = power, blue = speed, yellow = reach (towers) / durability (base).
const TINT = { dmg: [230, 57, 70], rate: [66, 135, 245], rng: [255, 209, 102] };
const BTINT = { hp: TINT.dmg, arm: TINT.rng, reg: TINT.rate, cmd: [180, 120, 255] };
const BASE_COL = '#9aa5b1';
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function tinted(col, lv, tints) {
  let tot = 0, r = 0, g = 0, b = 0;
  for (const k in lv) { const a = lv[k] / (lv[k] + 3); tot += a; r += a * tints[k][0]; g += a * tints[k][1]; b += a * tints[k][2]; }
  if (!tot) return col;
  const amt = Math.min(0.75, tot * 0.6), c0 = hexRgb(col), m = (c, t) => Math.round(c + (t / tot - c) * amt);
  return 'rgb(' + m(c0[0], r) + ',' + m(c0[1], g) + ',' + m(c0[2], b) + ')';
}
const rgbCss = a => 'rgb(' + a.join(',') + ')';
function polyPath(c, poly) {
  c.beginPath(); poly.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
}

function render() {
  const dpr = cv.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#10151c'; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const g = G;
  ctx.lineWidth = 1;
  for (const cell of g.grid.cells) {
    polyPath(ctx, cell.poly);
    ctx.fillStyle = cell.path ? '#3b3427' : '#1b2330'; ctx.fill();
    ctx.strokeStyle = cell.path ? '#4a4233' : '#273244'; ctx.stroke();
  }
  const bc = g.base, pulse = 1 + g.hurt * 1.5;
  polyPath(ctx, bc.poly); ctx.fillStyle = '#2b3340'; ctx.fill();
  shapePath(ctx, bc.cx, bc.cy, g.grid.cr * 1.5 * pulse, 6, Math.PI / 6);
  ctx.fillStyle = g.hurt > 0 ? '#fff' : tinted(BASE_COL, g.b, BTINT); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const bw = g.grid.cr * 3, hpf = clamp(g.hp / baseMax(), 0, 1), by = bc.cy - g.grid.cr * 1.9;
  ctx.fillStyle = '#000'; ctx.fillRect(bc.cx - bw / 2, by, bw, 4);
  ctx.fillStyle = hpf > 0.5 ? '#6bd36b' : hpf > 0.25 ? '#ffd166' : '#e63946'; ctx.fillRect(bc.cx - bw / 2, by, bw * hpf, 4);
  if (g.hover && g.armed && !g.hover.path && !g.hover.tower) {
    polyPath(ctx, g.hover.poly);
    ctx.fillStyle = !canBuild(g.armed) ? 'rgba(107,211,107,.35)' : 'rgba(230,57,70,.35)'; ctx.fill();
    ctx.beginPath(); ctx.arc(g.hover.cx, g.hover.cy, TD[g.armed].range * g.grid.unit, 0, TAU);
    ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.stroke();
  }
  if (g.sel) {
    ctx.beginPath(); ctx.arc(g.sel.x, g.sel.y, rangeOf(g.sel), 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
  }
  const cr = g.grid.cr;
  for (const t of g.towers) {
    const D = TD[t.type], tc = tinted(D.col, t.up, TINT);
    if (D.barrel) {
      ctx.strokeStyle = tc; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + Math.cos(t.ang) * cr * 1.25, t.y + Math.sin(t.ang) * cr * 1.25); ctx.stroke();
    }
    shapePath(ctx, t.x, t.y, cr, D.shape, D.rot || 0);
    ctx.fillStyle = tc; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = g.sel === t ? '#fff' : '#0d1015'; ctx.stroke();
    ctx.fillStyle = '#0d1015'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lvlOf(t), t.x, t.y + 0.5);
  }
  const drawEnemy = e => {
    shapePath(ctx, e.x, e.y, e.r, e.S.shape, e.S.rot || 0);
    if (e.S.elite) {
      ctx.strokeStyle = e.col; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + 0.4 * Math.sin(g.time * 6);
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      shapePath(ctx, e.x, e.y, e.r, e.S.shape, e.S.rot || 0);
    }
    ctx.fillStyle = e.flash > 0 ? '#fff' : (e.col || e.S.col); ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = e.burnT > 0 ? '#ff6b35' : e.slowT > 0 ? '#9bf6ff' : e.fly ? '#fff' : '#0d1015'; ctx.stroke();
    if (e.hp < e.max) {
      const w = e.r * 2;
      ctx.fillStyle = '#000'; ctx.fillRect(e.x - w / 2, e.y - e.r - 6, w, 3);
      ctx.fillStyle = '#6bd36b'; ctx.fillRect(e.x - w / 2, e.y - e.r - 6, w * Math.max(0, e.hp / e.max), 3);
    }
  };
  for (const e of g.enemies) if (!e.fly) drawEnemy(e);
  for (const p of g.projs) { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, TAU); ctx.fill(); }
  for (const e of g.enemies) if (e.fly) drawEnemy(e);
  for (const f of g.fx) {
    ctx.globalAlpha = f.t / f.max;
    if (f.type === 'line') { ctx.strokeStyle = f.col; ctx.lineWidth = f.w; ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
    else { ctx.strokeStyle = f.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke(); }
  }
  for (const p of g.parts) { ctx.globalAlpha = p.t / p.max; ctx.fillStyle = p.col; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of g.floats) { ctx.globalAlpha = Math.min(1, f.t * 2); ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, f.y); }
  ctx.globalAlpha = 1;
  if (g.hurt > 0) { ctx.fillStyle = 'rgba(230,57,70,' + g.hurt * 0.5 + ')'; ctx.fillRect(0, 0, W, H); }
  if (g.paused && !g.over) {
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.fillText('PAUSED', W / 2, H / 2);
  }
}

/* ---------------- ui ---------------- */
const cache = {};
function setText(id, txt) { if (cache[id] !== txt) { cache[id] = txt; $(id).textContent = txt; } }
let infoSig = '', cards = {};

function drawIcon(c, type, locked) {
  const x = c.getContext('2d'), D = TD[type];
  c.width = c.height = 60;
  x.fillStyle = locked ? '#555' : D.col;
  shapePath(x, 30, 30, 18, D.shape, D.rot || 0); x.fill();
  if (D.barrel) { x.strokeStyle = x.fillStyle; x.lineWidth = 6; x.beginPath(); x.moveTo(30, 30); x.lineTo(52, 12); x.stroke(); }
}
function buildShop() {
  const shop = $('shop'); shop.innerHTML = ''; cards = {};
  const bb = document.createElement('button');
  bb.className = 'card'; bb.dataset.t = '__base';
  bb.innerHTML = '<canvas></canvas><div>Base</div><div class="c">0/0</div>';
  const ic = bb.querySelector('canvas'); ic.width = ic.height = 60;
  const ix = ic.getContext('2d'); ix.fillStyle = '#9aa5b1'; shapePath(ix, 30, 30, 20, 6, Math.PI / 6); ix.fill();
  shop.appendChild(bb); cards.__base = bb;
  for (const type of TORDER) {
    const D = TD[type], open = !!save.unlocked[type];
    if (!open) continue;
    const b = document.createElement('button');
    b.className = 'card' + (open ? '' : ' locked'); b.dataset.t = type;
    b.innerHTML = '<canvas></canvas><div>' + D.name + '</div><div class="c">' + (open ? D.cost : 'lock') + '</div>';
    drawIcon(b.querySelector('canvas'), type, !open);
    shop.appendChild(b); cards[type] = b;
  }
}
function buildAbil() {
  const box = $('abil'); box.innerHTML = '';
  const have = AORDER.filter(id => save.abil[id]);
  $('app').classList.toggle('ab', have.length > 0);
  for (const id of have) {
    const b = document.createElement('button');
    b.className = 'ab'; b.id = 'ab_' + id; b.dataset.a = id; b.textContent = ABIL[id].name;
    box.appendChild(b);
  }
}
function updateButtons() {
  if (!G) return;
  $('bSpeed').textContent = 'x' + G.speed; $('bSpeed').disabled = save.speed < 2;
  $('bAuto').classList.toggle('on', G.auto);
  $('bPause').textContent = G.paused ? '>' : 'II';
  setText('bGo', G.wave === 0 ? 'Start' : 'Wave ' + (G.wave + 1));
}
function updateUi() {
  const g = G;
  setText('hLives', 'HP ' + Math.ceil(g.hp) + '/' + baseMax()); cards.__base.classList.toggle('armed', g.selBase);
  { const bt0 = cmdUsed() + '/' + cmdCap(); if (cards.__base._t !== bt0) { cards.__base._t = bt0; cards.__base.lastChild.textContent = bt0; } } setText('hGold', '$ ' + Math.floor(g.gold)); setText('hWave', 'W ' + g.wave);
  setText('bGo', g.wave === 0 ? 'Start' : 'Wave ' + (g.wave + 1));
  $('bGo').disabled = g.spawns.length > 0;
  for (const type of TORDER) {
    const b = cards[type], open = !!save.unlocked[type];
    if (!b) continue;
    b.classList.toggle('armed', g.armed === type);
    const why = open ? canBuild(type) : '';
    b.classList.toggle('poor', why === 'Need gold');
    b.classList.toggle('full', why === 'No command points');
    const txt = costOf(type) + '|' + TD[type].cmd;
    if (open && b._t !== txt) { b._t = txt; b.lastChild.innerHTML = costOf(type) + '<span class="k">·' + TD[type].cmd + '</span>'; }
  }
  for (const id of AORDER) {
    if (!save.abil[id]) continue;
    const b = $('ab_' + id), cd = g.cds[id];
    setText('ab_' + id, ABIL[id].name + (cd > 0 ? ' ' + Math.ceil(cd) : ''));
    b.disabled = cd > 0;
  }
  const t = g.sel, can = k => t && g.gold >= trackCost(t, k), canB = k => g.gold >= baseCost(k);
  const sig = g.selBase ? ['base', g.b.hp, g.b.arm, g.b.reg, g.b.cmd, canB('hp'), canB('arm'), canB('reg'), canB('cmd')].join('|')
    : [t ? [t.id, t.up.dmg, t.up.rate, t.up.rng, t.mode, can('dmg'), can('rate'), can('rng')].join(',') : '', g.armed, g.armed && g.gold >= costOf(g.armed)].join('|');
  if (sig === infoSig) return;
  infoSig = sig;
  const info = $('info');
  const bt = (act, k, label, cost, ok, tint) => '<button class="btn" style="border-bottom:3px solid ' + rgbCss(tint) + '" data-act="' + act + '" data-k="' + k + '"' + (ok ? '' : ' disabled') + '>' + label + '<br>' + (isFinite(cost) ? cost : 'max') + '</button>';
  if (g.selBase) {
    info.innerHTML = '<div class="txt"><b style="color:#9aa5b1">Base</b> <small>HP ' + baseMax() + ' | damage taken -' + Math.round((1 - armF()) * 100) + '% | regen ' + regenOf().toFixed(1) + '/s | command ' + cmdUsed() + '/' + cmdCap() + '</small></div>' +
      '<div class="brow">' + ['hp', 'arm', 'reg', 'cmd'].map(k => bt('bup', k, BTRACKS[k].label + ' L' + g.b[k], baseCost(k), canB(k), BTINT[k])).join('') + '</div>';
  } else if (t) {
    const D = TD[t.type];
    info.innerHTML = '<div class="txt"><b style="color:' + D.col + '">' + D.name + '</b> <small>DMG ' + dmgOf(t).toFixed(0) + ' | ' + rateOf(t).toFixed(1) + '/s | DPS ' +
      (dmgOf(t) * rateOf(t)).toFixed(0) + ' | range ' + (rangeOf(t) / g.grid.unit).toFixed(1) + '</small></div>' +
      '<div class="brow">' + ['dmg', 'rate', 'rng'].map(k => bt('tup', k, TRACKS[k].label + ' ' + t.up[k], trackCost(t, k), can(k), TINT[k])).join('') +
      '<button class="btn alt" data-act="mode">' + ['First', 'Strong', 'Weak'][t.mode] + '</button>' +
      '<button class="btn red" data-act="sell"' + (t.isBase ? ' disabled' : '') + '>Sell<br>' + Math.floor(t.spent * 0.7) + '</button></div>';
  } else if (g.armed) {
    const D = TD[g.armed];
    info.innerHTML = '<div class="txt"><b style="color:' + D.col + '">' + D.name + '</b> - ' + costOf(g.armed) + '<br><small>' + D.desc + '. Tap a free cell.</small></div>';
  } else {
    info.innerHTML = '<div class="txt"><b>' + g.L.name + (g.tier > 1 ? ' - Tier ' + g.tier : '') + '</b><br><small>Pick a tower below, then tap a free cell. Tap the base to upgrade it.</small></div>';
  }
}

function cellFromEvent(e) {
  const r = cv.getBoundingClientRect();
  return G.grid.cellAt((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H);
}
cv.addEventListener('pointermove', e => { if (G) G.hover = cellFromEvent(e); });
cv.addEventListener('pointerdown', e => {
  if (!G || G.over || G.paused) return;
  const cell = cellFromEvent(e); G.hover = cell;
  if (!cell) { G.sel = null; G.selBase = false; return; }
  if (cell.tower) { G.sel = cell.tower; G.armed = null; G.selBase = false; }
  else if (cell.base) { G.selBase = true; G.sel = null; G.armed = null; }
  else if (G.armed && !cell.path) { const why = canBuild(G.armed); if (!why && build(cell, G.armed)) G.sel = null; else if (why) floater(cell.cx, cell.cy - 10, why, '#ff7b8a'); }
  else { G.sel = null; G.selBase = false; }
});
$('shop').addEventListener('click', e => {
  const b = e.target.closest('.card');
  if (!b || !G) return;
  if (b.dataset.t === '__base') { G.selBase = !G.selBase; G.sel = null; G.armed = null; return; }
  if (!save.unlocked[b.dataset.t]) { $('info').innerHTML = '<div class="txt"><b>Locked</b><br><small>Unlock in the menu with gems.</small></div>'; infoSig = ''; return; }
  G.armed = G.armed === b.dataset.t ? null : b.dataset.t; G.sel = null; G.selBase = false;
});
$('info').addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (!act || !G) return;
  const a = act.dataset.act, k = act.dataset.k;
  if (a === 'bup') { upBase(k); return; }
  if (!G.sel) return;
  const t = G.sel;
  if (a === 'tup') upgrade(t, k);
  else if (a === 'sell') sell(t);
  else if (a === 'mode') t.mode = (t.mode + 1) % 3;
});
$('bGo').onclick = () => startWave();
$('abil').addEventListener('click', e => { const b = e.target.closest('.ab'); if (b) useAbility(b.dataset.a); });
$('bSpeed').onclick = () => { if (G) { G.speed = G.speed % save.speed + 1; updateButtons(); } };
$('bAuto').onclick = () => { if (G) { G.auto = !G.auto; updateButtons(); } };
$('bPause').onclick = () => { if (G && !G.over) { G.paused = !G.paused; updateButtons(); } };
$('bQuit').onclick = () => {
  if (!G || G.over) return;
  G.paused = true; updateButtons();
  showOv('<h1>PAUSED</h1><div class="sub">Wave ' + G.wave + '</div><button class="btn big" data-act="resume">Resume</button><button class="btn big red" data-act="endrun">End run</button>');
};

/* ---------------- overlays ---------------- */
function showOv(html) { $('ovBox').innerHTML = html; $('ov').style.display = 'block'; }
let menuConfirm = false;
const SPEED_COST = [0, 20, 60];
const techCost = type => Math.round(20 * Math.pow(techLv(type) + 1, 1.6));
let menuTab = 'play';
const TABS = [['play', 'Play'], ['up', 'Upgrades'], ['tow', 'Towers'], ['skill', 'Skills'], ['data', 'Data']];
function menuDots() {
  const g = save.gems;
  return {
    play: LEVELS.some((L, i) => !levelOpen(i) && g >= L.cost),
    up: Object.keys(UP).some(id => save.up[id] < UP[id].max && g >= UP[id].cost(save.up[id])),
    tow: TORDER.some(t => save.unlocked[t] ? techLv(t) < 15 && g >= techCost(t) : isSeen(t) && g >= TD[t].gems),
    skill: (save.speed < 3 && g >= SPEED_COST[save.speed]) || AORDER.some(id => !save.abil[id] && g >= ABIL[id].cost),
    data: false,
  };
}
function menuPlayTab() {
  let h = '<h3>Level</h3>';
  LEVELS.forEach((L, i) => {
    const open = levelOpen(i);
    h += '<div class="row"><div class="t"><b>' + L.name + '</b><small>Best wave ' + (save.best[L.id] || 0) + (L.desc ? ' | ' + L.desc : '') + '</small></div>' +
      (open ? '<button class="btn ' + (i === menuLevel ? '' : 'alt') + '" data-act="lvl" data-i="' + i + '">' + (i === menuLevel ? 'Selected' : 'Select') + '</button>'
        : '<button class="btn" data-act="unlvl" data-i="' + i + '"' + (save.gems < L.cost ? ' disabled' : '') + '>' + L.cost + ' gems</button>') + '</div>';
  });
  h += '<h3>Difficulty</h3><div class="row"><div class="t"><b>Tier ' + menuTier + '</b><small>Enemy HP +' + Math.round(60 * (menuTier - 1)) + '%, gems +' + Math.round(25 * (menuTier - 1)) +
    '%. Reach wave 15 on your top tier to unlock the next (' + save.tier + '/' + MAXTIER + ')</small></div>' +
    '<button class="btn alt" data-act="tierdn"' + (menuTier <= 1 ? ' disabled' : '') + '>-</button><button class="btn alt" data-act="tierup"' + (menuTier >= save.tier ? ' disabled' : '') + '>+</button></div>';
  return h;
}
function menuUpTab() {
  let h = '<h3>Permanent upgrades</h3>';
  for (const id in UP) {
    const u = UP[id], lv = save.up[id], maxed = lv >= u.max, c = u.cost(lv);
    h += '<div class="row"><div class="t"><b>' + u.name + ' ' + lv + '/' + u.max + '</b><small>' + u.desc + '</small></div><button class="btn" data-act="buyup" data-id="' + id + '"' +
      (maxed || save.gems < c ? ' disabled' : '') + '>' + (maxed ? 'Max' : c + ' gems') + '</button></div>';
  }
  return h;
}
function menuTowTab() {
  let h = '<h3>Towers</h3>';
  for (const type of TORDER) {
    const D = TD[type];
    if (!isSeen(type)) {
      h += '<div class="row"><div class="t"><b>Unknown</b><small>Reach wave ' + D.at + ' to discover</small></div><b>?</b></div>';
    } else if (!save.unlocked[type]) {
      h += '<div class="row"><div class="t"><b style="color:' + D.col + '">' + D.name + '</b><small>' + D.desc + ' | ' + D.cmd + ' command</small></div>' +
        '<button class="btn" data-act="unlock" data-id="' + type + '"' + (save.gems < D.gems ? ' disabled' : '') + '>' + D.gems + ' gems</button></div>';
    } else {
      h += '<div class="row"><div class="t"><b style="color:' + D.col + '">' + D.name + '</b><small>' + D.desc + ' | ' + D.cmd + ' command</small></div>' +
        (techLv(type) >= 15 ? '<small>Max</small>' : '<button class="btn alt" data-act="tech" data-id="' + type + '"' + (save.gems < techCost(type) ? ' disabled' : '') + '>Tech L' + techLv(type) + ' ' + techCost(type) + '</button>') + '</div>';
    }
  }
  return h;
}
function menuSkillTab() {
  let h = '<h3>Game speed</h3>' + (save.speed >= 3 ? '<div class="row"><div class="t"><b>Speed x3</b><small>Unlocked</small></div></div>'
    : '<div class="row"><div class="t"><b>Speed x' + (save.speed + 1) + '</b><small>Faster game button</small></div><button class="btn" data-act="buyspeed"' + (save.gems < SPEED_COST[save.speed] ? ' disabled' : '') + '>' + SPEED_COST[save.speed] + ' gems</button></div>');
  h += '<h3>Abilities</h3>';
  for (const id of AORDER) {
    const A = ABIL[id];
    h += '<div class="row"><div class="t"><b>' + A.name + '</b><small>' + A.desc + ' (cooldown ' + A.cd + ' s)</small></div>' +
      (save.abil[id] ? '<small>Owned</small>' : '<button class="btn" data-act="buyabil" data-id="' + id + '"' + (save.gems < A.cost ? ' disabled' : '') + '>' + A.cost + ' gems</button>') + '</div>';
  }
  return h;
}
function menuDataTab() {
  return '<h3>Data</h3>' + (menuConfirm
    ? '<div class="row"><div class="t"><b>Wipe all progress?</b><small>Gems, unlocks and upgrades are lost.</small></div><button class="btn red" data-act="reset">Yes, wipe</button><button class="btn alt" data-act="cancel">No</button></div>'
    : '<button class="btn alt big" data-act="askreset">Reset progress</button>');
}
function renderMenu(keepScroll = true) {
  menuTier = clamp(menuTier, 1, save.tier);
  const old = $('mbody'), keep = keepScroll && old ? old.scrollTop : 0, dots = menuDots();
  const body = { play: menuPlayTab, up: menuUpTab, tow: menuTowTab, skill: menuSkillTab, data: menuDataTab }[menuTab]();
  showOv('<div class="mwrap"><div class="mhead"><h1>TOWER DEFENCE</h1><div class="sub">Gems: ' + save.gems + '</div></div>' +
    '<div class="tabs">' + TABS.map(([id, label]) => '<button class="tab' + (id === menuTab ? ' on' : '') + '" data-act="tab" data-id="' + id + '">' + label + (dots[id] ? '<i></i>' : '') + '</button>').join('') + '</div>' +
    '<div class="mbody" id="mbody">' + body + '</div>' +
    '<div class="mfoot"><button class="btn big" data-act="play">Play ' + LEVELS[menuLevel].name + (menuTier > 1 ? ' - Tier ' + menuTier : '') + '</button></div></div>');
  if (keep) $('mbody').scrollTop = keep;
}
function renderOver() {
  showOv('<h1>GAME OVER</h1><div class="sub">' + G.L.name + (G.tier > 1 ? ' - Tier ' + G.tier : '') + '</div>' +
    '<div class="row"><div class="t"><b>Wave reached</b></div><b>' + G.wave + '</b></div>' +
    '<div class="row"><div class="t"><b>Kills</b></div><b>' + G.kills + '</b></div>' +
    (G.salvage ? '<div class="row"><div class="t"><b>Salvage</b><small>from leftover gold and towers</small></div><b>+' + G.salvage + '</b></div>' : '') +
    (G.newTowers.length ? '<div class="row"><div class="t"><b>New tower discovered</b><small>' + G.newTowers.join(', ') + ' - buy it in the menu</small></div></div>' : '') +
    (G.tierUp ? '<div class="row"><div class="t"><b>Tier ' + save.tier + ' unlocked!</b></div></div>' : '') +
    '<div class="row"><div class="t"><b>Gems earned</b></div><b>+' + G.gemsEarned + '</b></div>' +
    '<button class="btn big" data-act="retry">Retry</button><button class="btn big alt" data-act="menu">Menu</button>');
}
$('ov').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === 'tab') { menuTab = id; menuConfirm = false; renderMenu(false); }
  else if (act === 'lvl') { menuLevel = +b.dataset.i; renderMenu(); }
  else if (act === 'unlvl') { const L = LEVELS[+b.dataset.i]; if (save.gems >= L.cost) { save.gems -= L.cost; save.levels[L.id] = 1; persist(); renderMenu(); } }
  else if (act === 'perk') { const p = G.offer && G.offer[+b.dataset.i]; if (p) { p.apply(G.mods, G); G.offer = null; G.paused = false; infoSig = ''; $('ov').style.display = 'none'; updateButtons(); if (G.perkQ > 0) { G.perkQ--; offerPerks(); } } }
  else if (act === 'buyspeed') { const c = SPEED_COST[save.speed]; if (save.speed < 3 && save.gems >= c) { save.gems -= c; save.speed++; persist(); renderMenu(); } }
  else if (act === 'tierup') { menuTier = Math.min(save.tier, menuTier + 1); renderMenu(); }
  else if (act === 'tierdn') { menuTier = Math.max(1, menuTier - 1); renderMenu(); }
  else if (act === 'buyabil') { const A = ABIL[id]; if (!save.abil[id] && save.gems >= A.cost) { save.gems -= A.cost; save.abil[id] = 1; persist(); renderMenu(); } }
  else if (act === 'askreset') { menuConfirm = true; renderMenu(); }
  else if (act === 'cancel') { menuConfirm = false; renderMenu(); }
  else if (act === 'reset') { save = freshSave(); persist(); menuConfirm = false; menuLevel = 0; menuTier = 1; renderMenu(); }
  else if (act === 'play') startGame(menuLevel, menuTier);
  else if (act === 'retry') startGame(G.li, G.tier);
  else if (act === 'menu') { G = null; menuConfirm = false; renderMenu(); }
  else if (act === 'resume') { G.paused = false; $('ov').style.display = 'none'; updateButtons(); }
  else if (act === 'endrun') endRun();
  else if (act === 'buyup') { const c = UP[id].cost(save.up[id]); if (save.gems >= c && save.up[id] < UP[id].max) { save.gems -= c; save.up[id]++; persist(); renderMenu(); } }
  else if (act === 'unlock') { const D = TD[id]; if (D && isSeen(id) && !save.unlocked[id] && save.gems >= D.gems) { save.gems -= D.gems; save.unlocked[id] = 1; persist(); renderMenu(); } }
  else if (act === 'tech') { const c = techCost(id); if (save.gems >= c && techLv(id) < 15) { save.gems -= c; save.tech[id] = techLv(id) + 1; persist(); renderMenu(); } }
});

/* ---------------- main loop ---------------- */
function resize() {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.round((r.width || W) * dpr); cv.height = Math.round((r.width || W) * dpr * H / W);
}
window.addEventListener('resize', resize);
function frame(ts) {
  const real = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
  if (G && !G.over && !G.paused) {
    acc += real * G.speed;
    while (acc >= DT) { step(DT); acc -= DT; if (G.over || G.paused) break; }
  }
  if (G) { if (!G.over) updateUi(); }
  render();
  requestAnimationFrame(frame);
}
resize(); renderMenu();
requestAnimationFrame(frame);
window.__td = { LEVELS, TD, EN, startGame, step, startWave, build, upgrade, upBase, TRACKS, BTRACKS, useAbility, getG: () => G, buildPaths, save: () => save };
})();
