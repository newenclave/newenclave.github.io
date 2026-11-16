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
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 && !this.touch.recent()) this.rightClicks.push({ x: e.clientX, y: e.clientY });
      if (e.button !== 0 || this.touch.recent()) return; // ignore mouse events synthesized from touch
      this.mouse.down = true;
      this.clicks.push({ x: e.clientX, y: e.clientY });
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
    this.rightClicks.length = 0;
    this.touch.endFrame();
  }
}
