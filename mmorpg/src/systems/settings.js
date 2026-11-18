import { LANGS } from '../core/i18n.js';

// Player preferences. They live apart from the saved game, so "new game" or "delete save" keeps them.
export const SETTINGS_KEY = 'mmorpg-draft-settings';
export const TOUCH_MODES = ['auto', 'on', 'off'];

// The first time, the language is the browser's if the game has it (`prefer`: navigator.languages), else English.
export function preferredLang(prefer = []) {
  for (const p of prefer) { // the browser's own order: the first one the game has
    const l = String(p).toLowerCase().split('-')[0];
    if (LANGS.includes(l)) return l;
  }
  return 'en';
}
export const defaultSettings = (prefer = []) => ({ lang: preferredLang(prefer), fog: true, touch: 'auto' });

// Anything that is missing or does not fit falls back to its default.
export function sanitizeSettings(raw, prefer = []) {
  const d = defaultSettings(prefer);
  if (!raw || typeof raw !== 'object') return d;
  return {
    lang: LANGS.includes(raw.lang) ? raw.lang : d.lang,
    fog: typeof raw.fog === 'boolean' ? raw.fog : d.fog,
    touch: TOUCH_MODES.includes(raw.touch) ? raw.touch : d.touch,
  };
}

export function loadSettings(storage = globalThis.localStorage, prefer = []) {
  try {
    return sanitizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)), prefer);
  } catch {
    return defaultSettings(prefer);
  }
}

export function storeSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
