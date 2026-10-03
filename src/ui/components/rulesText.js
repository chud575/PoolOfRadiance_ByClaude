/**
 * Plain-language AD&D 1st Edition explanations for the character sheet,
 * creation screens and inventory tooltips. Each helper returns
 * {title, text} computed from the character's actual numbers.
 */
import {
  strengthTable, intelligenceTable, wisdomSaveAdj, wisdomBonusSpells, wisdomSpellFailure,
  dexterityMods, constitutionTable, charismaTable, formatStr,
} from '../../rules/abilities.js';
import { RACES } from '../../rules/races.js';
import { CLASSES, SAVE_NAMES, PR_LEVEL_CAPS, ALIGNMENT_NAMES, splitClasses } from '../../rules/classes.js';

const sgn = (n) => (n > 0 ? `+${n}` : String(n));

export const ALIGNMENT_TEXT = {
  LG: 'Honour, duty and the law. Paladins and the priests of Tyr walk this road.',
  NG: 'Kindness without dogma; doing good as the heart sees fit.',
  CG: 'Freedom and conscience above law; a rebel with a noble cause.',
  LN: 'Order for its own sake: codes, contracts and the letter of the law.',
  TN: 'Balance in all things; neither saint nor tyrant.',
  CN: 'Whim and self; free as the Moonsea wind, and as fickle.',
  LE: 'Tyranny with rules: ambition that keeps its bargains.',
  NE: 'Pure self-interest, without scruple or loyalty.',
  CE: 'Cruelty and chaos. Few in Phlan will deal with such a soul.',
};

/** @returns {{title:string, text:string}} */
export function abilityTip(key, a, classSpec = 'fighter') {
  const classes = splitClasses(classSpec);
  switch (key) {
    case 'str': {
      const t = strengthTable(a.str, a.strPct);
      return {
        title: `Strength ${formatStr(a.str, a.strPct)}`,
        text: `Melee to-hit ${sgn(t.hit)}, damage ${sgn(t.dmg)}. Carrying allowance ${sgn(t.weight)} coins. Opens doors ${t.doors} in 6, bends bars ${t.bars}%.${classes.includes('fighter') ? ' Fighters with 18 roll exceptional strength (18/01–18/00).' : ''}`,
      };
    }
    case 'int': {
      const t = intelligenceTable(a.int);
      return {
        title: `Intelligence ${a.int}`,
        text: t.maxSpellLevel
          ? `Magic-users may learn spells up to level ${t.maxSpellLevel}, with a ${t.knowChance}% chance to understand each new spell. Knows ${t.languages} extra language${t.languages === 1 ? '' : 's'}.`
          : 'Too dim to master the Art: magic-users need at least 9.',
      };
    }
    case 'wis': {
      const b = wisdomBonusSpells(a.wis);
      const f = wisdomSpellFailure(a.wis);
      return {
        title: `Wisdom ${a.wis}`,
        text: `Saves vs mind-affecting magic ${sgn(wisdomSaveAdj(a.wis))}. Clerics gain bonus spells ${b.some(Boolean) ? `(${b.map((n, i) => (n ? `${n}×L${i + 1}` : '')).filter(Boolean).join(', ')})` : '(none)'}${f ? ` but fail ${f}% of castings` : ''}.`,
      };
    }
    case 'dex': {
      const t = dexterityMods(a.dex);
      return {
        title: `Dexterity ${a.dex}`,
        text: `Armor Class ${sgn(t.ac)} (negative is better), missile to-hit ${sgn(t.missile)}, initiative ${sgn(t.reaction)}. Also helps dodge fireballs and lightning.`,
      };
    }
    case 'con': {
      const t = constitutionTable(a.con);
      return {
        title: `Constitution ${a.con}`,
        text: `Hit points ${sgn(classes.includes('fighter') ? t.hpFighter : t.hp)} per hit die${a.con >= 17 && !classes.includes('fighter') ? ' (fighters get more)' : ''}. System shock ${t.systemShock}%, resurrection survival ${t.resurrection}%.`,
      };
    }
    case 'cha': {
      const t = charismaTable(a.cha);
      return {
        title: `Charisma ${a.cha}`,
        text: `Reaction of strangers ${sgn(t.reaction)}%, loyalty ${sgn(t.loyalty)}%. Up to ${t.henchmen} henchmen would follow you.`,
      };
    }
    default:
      return { title: key, text: '' };
  }
}

export const STAT_TIPS = {
  thac0: (s) => ({
    title: `THAC0 ${s.thac0}`,
    text: (() => {
      const b = s.hitBonus ?? 0;
      const need = (ac) => Math.max(2, Math.min(20, s.thac0 - ac - b));
      const base = `"To Hit Armor Class 0": roll ${s.thac0} or more on a d20 to hit AC 0, one less for each point of AC above 0. Lower is better.`;
      return b ? `${base} With your ${sgn(b)} from weapon and strength you need ${need(5)} vs AC 5 and ${need(10)} vs AC 10.` : `${base} You need ${need(5)} vs AC 5 and ${need(10)} vs AC 10.`;
    })(),
  }),
  ac: (s) => ({
    title: `Armor Class ${s.ac}`,
    text: `10 is unarmoured; every point lower makes you harder to hit (plate and shield: 2). From behind you are AC ${s.acRear}. Dexterity, shields, rings and spells all help.`,
  }),
  hp: (ch) => ({
    title: `Hit Points ${ch.hp.cur}/${ch.hp.max}`,
    text: 'At 0 you fall unconscious; from −1 to −9 you are dying and lose 1 hp each round until bandaged; at −10 you are dead. Rest heals 1 hp per day; clerics heal faster.',
  }),
  damage: (s) => ({
    title: `Damage ${s.damage}${s.dmgBonus ? sgn(s.dmgBonus) : ''}`,
    text: `${s.weapon ? s.weapon.name : 'Bare hands'}: ${s.damage} against man-sized foes, ${s.damageLarge} against large ones${s.dmgBonus ? `, ${sgn(s.dmgBonus)} from strength and magic` : ''}. ${s.attacks !== 1 ? `${s.attacks} attacks per round.` : ''}`,
  }),
  move: (s) => ({
    title: `Movement ${s.move}`,
    text: `Squares per combat round. Base ${s.baseMove}, limited by race, armour and encumbrance (${s.encumbrance.label}).`,
  }),
  attacks: (s) => ({
    title: `Attacks ${s.attacks}/round`,
    text: 'Fighters gain extra attacks at higher levels (3/2 at 7th); bows fire twice per round. Fighters also sweep through foes of less than one hit die.',
  }),
  enc: (s) => ({
    title: `Encumbrance: ${s.encumbrance.label}`,
    text: `Carrying ${s.weight} coins' weight (10 coins = 1 lb). Heavier loads slow your movement: unencumbered 12, then 9, 6 and 3. Strength raises the limits.`,
  }),
  xp: (ch, cls, next) => ({
    title: `Experience ${ch.xp[cls] ?? 0}`,
    text: `${next ? `${next.toLocaleString('en-US')} XP for the next level. ` : ''}Experience comes from defeated foes and treasure. You must train at a hall (1,000 gp) to rise a level; Pool of Radiance caps ${CLASSES[cls].name.toLowerCase()}s at level ${PR_LEVEL_CAPS[cls]}.`,
  }),
  align: (al) => ({ title: ALIGNMENT_NAMES[al], text: ALIGNMENT_TEXT[al] }),
  save: (k, v) => ({
    title: `Save vs ${SAVE_NAMES[k] ?? k}: ${v}`,
    text: `Roll ${v} or more on a d20 to resist. ${{
      ppdm: 'Paralysis, poison and death magic: the saving throw that keeps you alive against ghoul claws and spider venom.',
      pp: 'Petrification and polymorph: basilisk gazes and transforming magic.',
      rsw: 'Rods, staves and wands: magic released from items.',
      bw: 'Breath weapons: dragon fire and similar blasts.',
      sp: 'Spells: everything else cast by wizards and priests (hold person, charm, stinking cloud).',
    }[k] ?? ''}`,
  }),
  thief: (name, v) => ({ title: `${name} ${v}%`, text: 'Chance of success. Thieves improve with every level; race and dexterity adjust the odds. Heavy armour spoils most thieving skills.' }),
  race: (id) => {
    const r = RACES[id];
    const adj = Object.entries(r.adjust).map(([k, v]) => `${k.toUpperCase()} ${sgn(v)}`).join(', ');
    return { title: r.name, text: `${r.desc}${adj ? ` Ability adjustments: ${adj}.` : ''}${r.infravision ? ` Infravision ${r.infravision}'.` : ''} Base move ${r.move}.` };
  },
  cls: (id) => {
    const c = CLASSES[id];
    return { title: c.name, text: `${c.desc} Hit die d${c.hitDie}; prime requisite ${c.primeReq.join(', ').toUpperCase()}. Level cap in Phlan: ${PR_LEVEL_CAPS[id]}.` };
  },
};

/** Racial level limit wording. */
export function levelLimitText(raceId) {
  const r = RACES[raceId];
  return Object.entries(r.levelLimits)
    .map(([c, l]) => `${CLASSES[c].name} ${l === Infinity ? 'unlimited' : l}`)
    .join(' · ');
}
