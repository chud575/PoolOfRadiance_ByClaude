import { EGA } from '../../src/render/palette.js';
import { buildParty } from '../../src/rules/party.js';
import { deriveStats } from '../../src/rules/character.js';
import { formatStr } from '../../src/rules/abilities.js';
import { ITEMS } from '../../src/data/items.js';
import { getSpell } from '../../src/rules/spells.js';
import { knownSpells } from '../../src/rules/camp.js';

/**
 * 1988 reference screens for the party workstream (character creation,
 * ENCAMP, VIEW, ITEMS, MEMORIZE), drawn from memory of the EGA original:
 * black screens, blue double frames, white and yellow 8x8 text, a small
 * digitised-style portrait box and the one-line command menu. Faithful, not
 * beautified. Registered into SCREENS by screens.js.
 */

const C = EGA;
const FRAME = C.lightBlue;

function frame2(e, x, y, w, h) {
  e.frame(x, y, w, h, FRAME);
  e.frame(x + 2, y + 2, w - 4, h - 4, C.blue);
}

function commandLine(e, words, row = 24, title = '') {
  let x = 1;
  e.rect(0, row * 8 - 1, 320, 9, C.black);
  if (title) {
    e.textAt(x, row, title, C.white);
    x += title.length + 1;
  }
  for (const w of words) {
    e.textAt(x, row, w[0], C.yellow);
    e.textAt(x + 1, row, w.slice(1), C.white);
    x += w.length + 1;
  }
}

/** A tiny EGA head-and-shoulders portrait (the original's 'portrait' boxes). */
function portrait(e, x, y, ch, seed = 0) {
  const skin = C.brown;
  const hair = [C.brown, C.darkGray, C.yellow, C.lightRed, C.lightGray][seed % 5];
  e.rect(x, y, 40, 48, C.black);
  e.frame(x - 1, y - 1, 42, 50, FRAME);
  // shoulders/armour
  e.rect(x + 4, y + 36, 32, 12, ch?.classSpec?.includes('magicUser') && !ch.classSpec.includes('fighter') ? C.magenta : C.lightGray);
  e.rect(x + 8, y + 34, 24, 4, C.darkGray);
  // neck + head
  e.rect(x + 16, y + 28, 8, 7, skin);
  e.rect(x + 11, y + 8, 18, 22, skin);
  e.rect(x + 10, y + 12, 1, 12, skin);
  e.rect(x + 29, y + 12, 1, 12, skin);
  // hair
  e.rect(x + 10, y + 5, 20, 6, hair);
  e.rect(x + 9, y + 8, 2, 8, hair);
  e.rect(x + 29, y + 8, 2, 8, hair);
  // eyes, nose, mouth
  e.rect(x + 14, y + 16, 3, 2, C.black);
  e.rect(x + 23, y + 16, 3, 2, C.black);
  e.rect(x + 19, y + 18, 2, 5, C.lightRed);
  e.rect(x + 16, y + 25, 8, 1, C.red);
  if (seed % 3 === 1) e.rect(x + 12, y + 24, 16, 6, hair); // beard
}

const party = () => buildParty('default', 1);

export const PARTY_SCREENS = {
  /** Character creation: race list / ability roll / portrait pick / party menu. */
  create(e, q) {
    e.cls(C.black);
    const step = q.get('step') ?? (q.get('party') ? 'party' : 'race');
    if (step === 'party') {
      const p = party();
      frame2(e, 0, 0, 320, 191);
      e.textAt(2, 2, 'POOL OF RADIANCE', C.yellow);
      e.textAt(2, 4, 'NAME', C.white);
      e.textAt(22, 4, 'AC', C.white);
      e.textAt(27, 4, 'HP', C.white);
      p.forEach((ch, i) => {
        const s = deriveStats(ch);
        const col = i === 0 ? C.white : C.lightGreen;
        e.textAt(2, 6 + i, ch.name.toUpperCase().slice(0, 15), col);
        e.textAt(22, 6 + i, String(s.ac).padStart(2), col);
        e.textAt(27, 6 + i, String(ch.hp.cur).padStart(3), col);
      });
      commandLine(e, ['CREATE', 'ADD', 'DROP', 'MODIFY', 'TRAIN', 'VIEW', 'BEGIN'], 22, '');
      commandLine(e, ['LOAD', 'SAVE', 'EXIT'], 23, '');
      return;
    }
    frame2(e, 0, 0, 320, 191);
    const ch = party()[0];
    portrait(e, 12, 12, ch, 0);
    e.textAt(8, 2, 'TARAN', C.white);
    e.textAt(8, 3, 'HUMAN MALE', C.white);
    e.textAt(8, 4, 'FIGHTER', C.white);
    e.textAt(8, 5, 'LAWFUL GOOD', C.white);
    if (step === 'portrait') {
      e.textAt(2, 9, 'PICK HEAD:', C.yellow);
      for (let i = 0; i < 6; i++) portrait(e, 12 + i * 48, 84, ch, i);
      commandLine(e, ['NEXT', 'PREV', 'SELECT', 'EXIT'], 22, '');
      return;
    }
    if (step === 'race') {
      e.textAt(2, 9, 'PICK RACE:', C.yellow);
      ['DWARF', 'ELF', 'GNOME', 'HALF-ELF', 'HALFLING', 'HUMAN'].forEach((r, i) => e.textAt(4, 11 + i, r, i === 5 ? C.lightCyan : C.white));
      commandLine(e, ['SELECT', 'EXIT'], 22, '');
      return;
    }
    const a = ch.abilities;
    const rows = [['STR', formatStr(a.str, a.strPct)], ['INT', a.int], ['WIS', a.wis], ['DEX', a.dex], ['CON', a.con], ['CHA', a.cha]];
    rows.forEach(([k, v], i) => {
      e.textAt(2, 9 + i, k, C.white);
      e.textAt(7, 9 + i, String(v), C.white);
    });
    const s = deriveStats(ch);
    e.textAt(18, 9, `AGE ${ch.age}`, C.white);
    e.textAt(18, 10, `HP ${ch.hp.max}`, C.white);
    e.textAt(18, 11, `AC ${s.ac}`, C.white);
    e.textAt(18, 12, `THAC0 ${s.thac0}`, C.white);
    e.textAt(18, 13, 'EXP 0', C.white);
    e.textAt(18, 14, 'LEVEL 1', C.white);
    e.textAt(2, 18, 'KEEP THIS CHARACTER?', C.yellow);
    commandLine(e, ['YES', 'NO'], 22, '');
  },

  /** ENCAMP: the party list and the camp menu. */
  camp(e, q) {
    e.cls(C.black);
    frame2(e, 0, 0, 320, 191);
    const p = party();
    e.textAt(2, 2, 'NAME', C.white);
    e.textAt(22, 2, 'AC', C.white);
    e.textAt(27, 2, 'HP', C.white);
    p.forEach((ch, i) => {
      const s = deriveStats(ch);
      const col = i === 0 ? C.white : C.lightGreen;
      e.textAt(2, 4 + i, ch.name.toUpperCase().slice(0, 15), col);
      e.textAt(22, 4 + i, String(s.ac).padStart(2), col);
      e.textAt(27, 4 + i, String(ch.hp.cur).padStart(3), col);
    });
    e.rect(3, 104, 314, 1, FRAME);
    if (q.get('sleep')) {
      e.textAt(2, 15, 'THE PARTY IS RESTING.', C.white);
      e.textAt(2, 17, 'DAYS 0 HOURS 2 MINUTES 10', C.white);
      commandLine(e, ['INTERRUPT'], 23, 'REST:');
    } else {
      e.textAt(2, 15, 'THE PARTY HAS STOPPED TO CAMP.', C.white);
      commandLine(e, ['SAVE', 'VIEW', 'MAGIC', 'REST', 'ALTER', 'FIX', 'EXIT'], 23, 'CAMP:');
    }
  },

  /** VIEW: the character sheet. */
  charsheet(e, q) {
    e.cls(C.black);
    const p = party();
    const ch = p[Number(q.get('member') ?? 0)] ?? p[0];
    const s = deriveStats(ch);
    portrait(e, 6, 6, ch, 0);
    e.textAt(7, 1, ch.name.toUpperCase(), C.white);
    e.textAt(7, 2, `${ch.race.toUpperCase()} ${ch.gender === 'female' ? 'FEMALE' : 'MALE'}`, C.white);
    e.textAt(7, 3, 'LAWFUL GOOD', C.white);
    e.textAt(7, 4, s.className?.toUpperCase?.() ?? 'FIGHTER', C.white);
    const a = s.abilities;
    const rows = [['STR', formatStr(a.str, a.strPct)], ['INT', a.int], ['WIS', a.wis], ['DEX', a.dex], ['CON', a.con], ['CHA', a.cha]];
    rows.forEach(([k, v], i) => {
      e.textAt(1, 8 + i, k, C.white);
      e.textAt(5, 8 + i, String(v), C.white);
    });
    e.textAt(16, 8, `AGE ${ch.age}`, C.white);
    e.textAt(16, 9, `HIT POINTS ${ch.hp.cur}`, C.white);
    e.textAt(16, 10, `ARMOR CLASS ${s.ac}`, C.white);
    e.textAt(16, 11, `THAC0 ${s.thac0}`, C.white);
    e.textAt(16, 12, `DAMAGE ${s.damage}`, C.white);
    e.textAt(16, 13, 'EXP 0', C.white);
    e.textAt(16, 14, `LEVEL ${s.levels}`, C.white);
    e.textAt(1, 16, 'READY:', C.yellow);
    ch.inventory.filter((x) => x.equipped).slice(0, 4).forEach((x, i) => e.textAt(1, 17 + i, (ITEMS[x.id]?.name ?? x.id).toUpperCase(), C.white));
    e.textAt(24, 16, `GOLD ${ch.gold ?? 0}`, C.white);
    commandLine(e, ['ITEMS', 'SPELLS', 'TRADE', 'DROP', 'EXIT'], 24, 'VIEW:');
  },

  /** ITEMS: the inventory list. */
  inventory(e, q) {
    e.cls(C.black);
    const p = party();
    const ch = p[Number(q.get('member') ?? 0)] ?? p[0];
    e.textAt(1, 1, `${ch.name.toUpperCase()}'S ITEMS`, C.white);
    e.textAt(1, 3, 'READY', C.white);
    e.textAt(9, 3, 'ITEM', C.white);
    e.textAt(30, 3, 'BULK', C.white);
    ch.inventory.forEach((x, i) => {
      const def = ITEMS[x.id];
      const col = i === 0 ? C.black : C.white;
      if (i === 0) e.rect(0, (5 + i) * 8 - 1, 320, 9, C.lightGray);
      e.textAt(1, 5 + i, x.equipped ? 'YES' : ' NO', col);
      e.textAt(9, 5 + i, `${(def?.name ?? x.id).toUpperCase()}${(x.qty ?? 1) > 1 ? ` ${x.qty}` : ''}`.slice(0, 20), col);
      e.textAt(30, 5 + i, String(def?.weight ?? 0).padStart(4), col);
    });
    commandLine(e, ['READY', 'USE', 'TRADE', 'DROP', 'HALVE', 'JOIN', 'EXIT'], 24, '');
  },

  /** MAGIC > MEMORIZE: the spell list with level counts. */
  memorize(e, q) {
    e.cls(C.black);
    const p = party();
    const ch = p[Number(q.get('member') ?? 1)] ?? p[1];
    const cls = String(ch.classSpec).includes('cleric') ? 'cleric' : 'magicUser';
    e.textAt(1, 1, `${ch.name.toUpperCase()}`, C.white);
    e.textAt(1, 2, 'CHOOSE SPELLS TO MEMORIZE:', C.yellow);
    e.textAt(1, 4, 'LEVEL 1  (3 LEFT)', C.white);
    knownSpells(ch, cls).slice(0, 12).forEach((id, i) => {
      const col = i === 0 ? C.black : C.white;
      if (i === 0) e.rect(0, (6 + i) * 8 - 1, 320, 9, C.lightGray);
      e.textAt(3, 6 + i, (getSpell(id)?.name ?? id).toUpperCase().slice(0, 30), col);
    });
    commandLine(e, ['SELECT', 'EXIT'], 24, 'MEMORIZE:');
  },
};
