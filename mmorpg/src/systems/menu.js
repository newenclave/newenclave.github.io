import { LANGS } from '../core/i18n.js';
import { TOUCH_MODES } from './settings.js';

// Menu logic without any drawing. Screens: main, pause, settings, controls, confirm.
// ctx = { hasSave, settings }. Clicking an item either moves between screens (returns null)
// or returns an action for the game to carry out: continue, new, delete, resume, save, toMain, settings.

export const newMenu = (screen = 'main') => ({ screen, stack: [], confirm: null, cursor: 0 });

function go(menu, screen) {
  menu.stack.push(menu.screen);
  menu.screen = screen;
  menu.cursor = 0;
}

function ask(menu, action, textKey) {
  menu.confirm = { action, textKey };
  go(menu, 'confirm');
}

const cycle = (list, value) => list[(list.indexOf(value) + 1) % list.length];

// Items of the current screen. `argKeys` are language keys that the drawing code translates.
export function menuItems(menu, ctx) {
  const { hasSave, settings } = ctx;
  switch (menu.screen) {
    case 'main':
      return [
        { id: 'continue', key: 'menu.continue', enabled: hasSave },
        { id: 'new', key: 'menu.new' },
        ...(hasSave ? [{ id: 'delete', key: 'menu.delete', danger: true }] : []),
        { id: 'settings', key: 'menu.settings' },
        { id: 'controls', key: 'menu.controls' },
      ];
    case 'pause':
      return [
        { id: 'resume', key: 'menu.resume' },
        { id: 'save', key: 'menu.save' },
        { id: 'settings', key: 'menu.settings' },
        { id: 'controls', key: 'menu.controls' },
        { id: 'toMain', key: 'menu.toMain' },
      ];
    case 'settings':
      return [
        { id: 'lang', key: 'menu.lang', argKeys: { name: `lang.${settings.lang}` } },
        { id: 'fog', key: 'menu.fog', argKeys: { state: settings.fog ? 'menu.on' : 'menu.off' } },
        { id: 'touch', key: 'menu.touch', argKeys: { mode: `menu.touch.${settings.touch}` } },
        { id: 'back', key: 'menu.back' },
      ];
    case 'controls':
      return [{ id: 'back', key: 'menu.back' }];
    case 'confirm':
      return [
        { id: 'yes', key: 'menu.yes', danger: true },
        { id: 'no', key: 'menu.no' },
      ];
    default:
      return [];
  }
}

export function menuClick(menu, id, ctx) {
  const item = menuItems(menu, ctx).find((i) => i.id === id);
  if (!item || item.enabled === false) return null;
  const { settings } = ctx;

  switch (id) {
    case 'continue':
    case 'resume':
    case 'save':
    case 'toMain':
      return { action: id };
    case 'new':
      if (ctx.hasSave) { ask(menu, 'new', 'menu.confirm.new'); return null; }
      return { action: 'new' };
    case 'delete':
      ask(menu, 'delete', 'menu.confirm.delete');
      return null;
    case 'settings':
    case 'controls':
      go(menu, id);
      return null;
    case 'lang':
      settings.lang = cycle(LANGS, settings.lang);
      return { action: 'settings' };
    case 'fog':
      settings.fog = !settings.fog;
      return { action: 'settings' };
    case 'touch':
      settings.touch = cycle(TOUCH_MODES, settings.touch);
      return { action: 'settings' };
    case 'back':
    case 'no':
      menuBack(menu);
      menu.confirm = null;
      return null;
    case 'yes': {
      const { action } = menu.confirm;
      menu.confirm = null;
      menuBack(menu);
      return { action };
    }
    default:
      return null;
  }
}

// Goes one screen back. Returns false when already at the first screen.
export function menuBack(menu) {
  if (menu.stack.length === 0) return false;
  menu.screen = menu.stack.pop();
  menu.cursor = 0;
  return true;
}

// Escape: back out of sub-screens; on the pause menu it resumes the game; on the main menu it does nothing.
export function menuEscape(menu) {
  if (menu.screen === 'confirm') menu.confirm = null;
  if (menuBack(menu)) return null;
  return menu.screen === 'pause' ? { action: 'resume' } : null;
}

// Moves the keyboard cursor, skipping disabled items and wrapping around.
export function menuMove(menu, items, dir) {
  const n = items.length;
  if (!n || items.every((i) => i.enabled === false)) return;
  let i = menu.cursor;
  do {
    i = (i + dir + n) % n;
  } while (items[i].enabled === false);
  menu.cursor = i;
}

export function menuEnter(menu, ctx) {
  const item = menuItems(menu, ctx)[menu.cursor];
  return item ? menuClick(menu, item.id, ctx) : null;
}

// The cursor must point at an enabled item (e.g. after Continue became unavailable).
export function fixCursor(menu, items) {
  if (items[menu.cursor] && items[menu.cursor].enabled !== false) return;
  const first = items.findIndex((i) => i.enabled !== false);
  menu.cursor = first < 0 ? 0 : first;
}
