let dict = {};
let fallback = {};

// Languages that have a file in data/lang/. The menu cycles through this list.
export const LANGS = ['en'];

// A language is its main file plus its conversations (data/lang/<l>.dialogue.json), merged into one dictionary.
export async function loadLang(lang) {
  const load = async (l) => {
    const [main, talk] = await Promise.all([
      fetch(`data/lang/${l}.json`).then((r) => r.json()),
      fetch(`data/lang/${l}.dialogue.json`).then((r) => r.json()).catch(() => ({})),
    ]);
    return { ...talk, ...main };
  };
  fallback = await load('en');
  dict = lang === 'en' ? fallback : await load(lang).catch(() => fallback);
}

// t('hud.position', { x: 1, y: 2 }) -> "Pos: 1, 2"
export function t(key, params = {}) {
  const s = dict[key] ?? fallback[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
}
