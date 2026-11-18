import { TouchControls } from './touch.js';

export class Input {
  constructor(canvas) {
    this.touch = new TouchControls(canvas);
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.down = false; });
    canvas.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    this.clicks = [];
    this.rightClicks = []; // quick actions on panels (sell, equip)
    this.releases = []; // left button let go: { x, y, moved } (a click that was not a drag, for screens you can drag)
    this.wheel = 0; // wheel turned this frame (positive: away from you, zoom out)
    this.downAt = null;
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 && !this.touch.recent()) this.rightClicks.push({ x: e.clientX, y: e.clientY });
      if (e.button !== 0 || this.touch.recent()) return; // ignore mouse events synthesized from touch
      this.mouse.down = true;
      this.downAt = { x: e.clientX, y: e.clientY };
      this.clicks.push({ x: e.clientX, y: e.clientY });
    });
    addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.mouse.down = false;
      if (this.downAt) {
        const x = e.clientX ?? this.downAt.x; // (a made-up event without a place: where the button went down)
        const y = e.clientY ?? this.downAt.y;
        this.releases.push({ x, y, x0: this.downAt.x, y0: this.downAt.y, moved: Math.hypot(x - this.downAt.x, y - this.downAt.y) > 6 });
      }
      this.downAt = null;
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault?.();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) { return this.keys.has(code); }
  // Something being dragged right now, by the mouse or by one finger on a panel: { x0, y0, x, y } (where it began, where
  // it is), or null. Lets a panel draw what is carried.
  dragNow() {
    if (this.mouse.down && this.downAt) return { x0: this.downAt.x, y0: this.downAt.y, x: this.mouse.x, y: this.mouse.y };
    return this.touch.dragNow();
  }
  // Drags that ended this frame: [{ x0, y0, x, y }] (the mouse let go after moving, or a finger lifted after moving).
  drops() {
    return [...this.releases.filter((r) => r.moved), ...this.touch.drops];
  }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
    this.rightClicks.length = 0;
    this.releases.length = 0;
    this.wheel = 0;
    this.touch.endFrame();
  }
}
