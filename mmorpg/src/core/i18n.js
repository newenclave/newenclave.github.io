let dict = {};
let fallback = {};
let current = 'en';

// Languages that have a file in data/lang/. The menu cycles through this list.
export const LANGS = ['en', 'ru'];
export const langNow = () => current;

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
  current = dict === fallback ? 'en' : lang;
}

// Names the game makes up from syllables ("Kelmar Ashford", "Skraix") are Latin; in Russian they are spelled in
// Cyrillic. Only a value that looks like a name is touched: capitalised Latin words, nothing else.
const NAME = /^[A-Z][a-z]+(?:[ '-][A-Z]?[a-z]+)*$/;
const PAIRS = [['sch', 'ш'], ['th', 'т'], ['sh', 'ш'], ['ch', 'ч'], ['ck', 'к'], ['ph', 'ф'], ['wh', 'у'], ['qu', 'кв'],
  ['ee', 'и'], ['oo', 'у'], ['ea', 'и'], ['ai', 'эй'], ['ay', 'эй'], ['ey', 'ей'], ['oy', 'ой'], ['ow', 'оу'], ['aw', 'о'],
  ['ie', 'и'], ['ts', 'ц'], ['x', 'кс'], ['j', 'дж']];
const ONE = { a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о',
  p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', y: 'и', z: 'з', "'": '' };
const VOWEL = /[aeiouy]/;
function cyrWord(w) {
  const low = w.toLowerCase();
  let out = '';
  for (let i = 0; i < low.length;) {
    if (i === 0 && low[0] === 'e') { out += 'э'; i += 1; continue; } // Ellen -> Эллен
    if (low[i] === 'y' && VOWEL.test(low[i + 1] ?? '') && (i === 0 || VOWEL.test(low[i - 1]))) { out += 'й'; i += 1; continue; } // Yor -> Йор
    if (low[i] === 'e' && i === low.length - 1 && i > 2 && !VOWEL.test(low[i - 1])) { i += 1; continue; } // a silent e: Ashmore -> Ашмор
    const pair = PAIRS.find(([en]) => low.startsWith(en, i));
    if (pair) { out += pair[1]; i += pair[0].length; continue; }
    out += ONE[low[i]] ?? low[i];
    i += 1;
  }
  return w[0] === w[0].toUpperCase() ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}
export const cyrillicName = (s) => s.replace(/[A-Za-z']+/g, cyrWord);
const localValue = (v) => (current === 'ru' && typeof v === 'string' && NAME.test(v) ? cyrillicName(v) : v);

// t('hud.position', { x: 1, y: 2 }) -> "Pos: 1, 2"
export function t(key, params = {}) {
  const s = dict[key] ?? fallback[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? localValue(params[k]) : `{${k}}`));
}
