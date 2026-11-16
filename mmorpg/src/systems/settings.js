import { LANGS } from '../core/i18n.js';

// Player preferences. They live apart from the saved game, so "new game" or "delete save" keeps them.
export const SETTINGS_KEY = 'mmorpg-draft-settings';
export const TOUCH_MODES = ['auto', 'on', 'off'];

export const defaultSettings = () => ({ lang: 'en', fog: true, touch: 'auto' });

// Anything that is missing or does not fit falls back to its default.
export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  return {
    lang: LANGS.includes(raw.lang) ? raw.lang : d.lang,
    fog: typeof raw.fog === 'boolean' ? raw.fog : d.fog,
    touch: TOUCH_MODES.includes(raw.touch) ? raw.touch : d.touch,
  };
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return sanitizeSettings(JSON.parse(storage.getItem(SETTINGS_KEY)));
  } catch {
    return defaultSettings();
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
