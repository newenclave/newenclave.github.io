// Touch controls: floating move stick (left half), aim/attack stick (right half),
// on-screen buttons and a tappable hotbar. Pure input state, no drawing here.

export const STICK_MAX = 55;
const DEADZONE = 0.12;

// Window buttons sit in one row left of the minimap, so they never collide with the action buttons below.
const TOP_ROW = ['skills', 'bag', 'journal', 'map', 'menu'];
const SECOND_ROW = ['bestiary'];

export function buttonLayout(w, h) {
  return [
    { id: 'roll', x: w - 70, y: h - 140, r: 34 },
    { id: 'swap', x: w - 150, y: h - 90, r: 26 },
    { id: 'talk', x: w - 155, y: h - 175, r: 30 }, // shown only next to an NPC or a door
    { id: 'boat', x: w - 235, y: h - 135, r: 28 }, // shown only where you can board or land
    ...TOP_ROW.map((id, i) => ({ id, x: w - 150 - i * 46, y: 34, r: 20 })),
    ...SECOND_ROW.map((id, i) => ({ id, x: w - 150 - i * 46, y: 82, r: 20 })),
  ];
}

export function hotbarLayout(w, h, count) {
  const sw = 54;
  const gap = 6;
  const x0 = w / 2 - (count * sw + (count - 1) * gap) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (sw + gap), y: h - 56, w: sw, h: 46 }));
}

const LONG_PRESS_MS = 450; // held this long (and still) on a panel, a touch acts like a right click
const LONG_PRESS_SLOP = 12; // pixels it may wander

export class TouchControls {
  constructor(canvas) {
    this.enabled = false;
    this.mode = 'auto'; // 'auto': switches on at the first touch, 'on': always, 'off': touches act like a mouse
    this.blocked = false; // a full-screen panel is open: touches only produce taps
    this.slotCount = 0;
    this.talkVisible = false; // the Talk button exists only while an NPC or a door is in reach
    this.boatVisible = false; // the Boat button, only where you can board or land
    this.pressed = new Set();
    this.taps = [];
    this.longPresses = []; // a finger held still on a panel: the touch version of a right click
    this.held = new Map(); // pointer id -> where and when a touch on a panel began
    this.pointers = new Map();
    this.move = { x: 0, y: 0 };
    this.aim = { active: false, dx: 0, dy: 0, mag: 0 };
    this.lastTouch = -1e9;

    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
  }

  setMode(mode) {
    this.mode = mode;
    this.enabled = mode === 'on';
    this.releaseAll();
  }

  recent(ms = 800) {
    return performance.now() - this.lastTouch < ms;
  }

  onDown(e) {
    if (e.pointerType === 'mouse' || this.mode === 'off') return; // 'off': the browser turns the touch into mouse events
    e.preventDefault();
    this.enabled = true;
    this.lastTouch = performance.now();
    const { clientX: x, clientY: y } = e;
    const w = innerWidth;
    const h = innerHeight;
    this.taps.push({ x, y });
    if (this.blocked) {
      this.held.set(e.pointerId, { x, y, t: performance.now() });
      return;
    }

    const button = buttonLayout(w, h)
      .find((b) => (b.id !== 'talk' || this.talkVisible) && (b.id !== 'boat' || this.boatVisible) && Math.hypot(x - b.x, y - b.y) <= b.r + 8);
    if (button) {
      this.pressed.add(button.id);
      this.pointers.set(e.pointerId, { kind: 'button' });
      return;
    }
    const slot = hotbarLayout(w, h, this.slotCount)
      .findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
    if (slot >= 0) {
      this.pressed.add('slot' + slot);
      this.pointers.set(e.pointerId, { kind: 'button' });
      return;
    }
    const kind = x < w / 2 ? 'move' : 'aim';
    for (const p of this.pointers.values()) if (p.kind === kind) return; // one stick per side
    this.pointers.set(e.pointerId, { kind, ox: x, oy: y, x, y });
    try { e.target.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.refresh();
  }

  onMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || p.kind === 'button') return;
    p.x = e.clientX;
    p.y = e.clientY;
    this.refresh();
  }

  onUp(e) {
    const held = this.held.get(e.pointerId);
    this.held.delete(e.pointerId);
    if (held && e.type === 'pointerup' && performance.now() - held.t >= LONG_PRESS_MS
      && Math.hypot(e.clientX - held.x, e.clientY - held.y) <= LONG_PRESS_SLOP) this.longPresses.push({ x: held.x, y: held.y });
    if (this.pointers.delete(e.pointerId)) this.refresh();
  }

  releaseAll() {
    this.pointers.clear();
    this.refresh();
  }

  refresh() {
    this.move = { x: 0, y: 0 };
    this.aim = { active: false, dx: 0, dy: 0, mag: 0 };
    for (const p of this.pointers.values()) {
      if (p.kind === 'button') continue;
      const dx = p.x - p.ox;
      const dy = p.y - p.oy;
      const d = Math.hypot(dx, dy);
      if (p.kind === 'move') {
        const mag = Math.min(1, d / STICK_MAX);
        if (mag >= DEADZONE) this.move = { x: (dx / d) * mag, y: (dy / d) * mag };
      } else {
        this.aim = { active: true, dx: d > 0 ? dx / d : 0, dy: d > 0 ? dy / d : 0, mag: d };
      }
    }
  }

  endFrame() {
    this.pressed.clear();
    this.taps.length = 0;
    this.longPresses.length = 0;
  }
}
