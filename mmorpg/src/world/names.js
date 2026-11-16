import { hash2 } from '../core/rng.js';

// Names from syllables, decided by the seed and a place (so the same person always has the same name). People get a
// given name and a family name; beasts from the Deep a harsh single name.
const FIRST = ['Al', 'Bran', 'Cor', 'Dun', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Kel', 'Lir', 'Mor', 'Ned', 'Os', 'Per',
  'Quil', 'Ros', 'Sel', 'Tam', 'Ul', 'Ver', 'Wyn', 'Yor', 'Ash', 'Bel', 'Cael', 'Dar', 'Eda', 'Mira', 'Nell', 'Tova'];
const MID = ['', '', 'a', 'e', 'i', 'o', 'ar', 'en', 'il', 'or'];
const LAST = ['n', 'th', 'ra', 'wyn', 'dric', 'la', 'mar', 'sa', 'ric', 'dell', 'ven', 'rin', 'na', 'bert', 'mond', 'lie'];
const FAMILY_A = ['Ash', 'Cold', 'Stone', 'Mill', 'Thorn', 'Har', 'Brook', 'Iron', 'Fair', 'Gray', 'Wick', 'Marsh', 'Oak', 'Salt'];
const FAMILY_B = ['well', 'by', 'wood', 'ford', 'field', 'ley', 'stone', 'hart', 'more', 'wick', 'hollow', 'bridge'];
const BEAST_A = ['Gor', 'Skra', 'Vul', 'Mor', 'Kra', 'Zug', 'Thra', 'Ul', 'Grim', 'Nak', 'Ssi', 'Bra', 'Qor', 'Yth'];
const BEAST_B = ['rak', 'gash', 'oth', 'ul', 'ix', 'ar', 'ok', 'eth', 'aak', 'uun', 'ess', 'og'];

const pick = (list, a, b, seed, salt) => list[Math.floor(hash2(a * 7 + salt, b * 13 - salt, seed + 9901 + salt * 31) * list.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A person: "Kelmar Ashford". (a, b) say where they come from, salt which of the people there.
export function personName(seed, a, b, salt = 0) {
  const given = pick(FIRST, a, b, seed, salt) + pick(MID, a, b, seed, salt + 1) + pick(LAST, a, b, seed, salt + 2);
  const family = pick(FAMILY_A, a, b, seed, salt + 3) + pick(FAMILY_B, a, b, seed, salt + 4);
  return `${cap(given)} ${family}`;
}

// A beast from the Deep: "Skraix".
export const beastName = (seed, a, b, salt = 0) => cap(pick(BEAST_A, a, b, seed, salt + 5) + pick(BEAST_B, a, b, seed, salt + 6));
