/**
 * Seeded dice. NEVER use Math.random() in game logic — always pass an Rng so
 * combat, encounters and screenshots are reproducible from ?seed=.
 */
export class Rng {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
    this.state = this.seed;
  }

  /** mulberry32 → float in [0,1) */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Roll one die with `sides` faces. */
  die(sides) {
    return this.int(1, sides);
  }

  /** @template T @param {T[]} arr @returns {T} */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Percentage check: true with probability pct/100. */
  chance(pct) {
    return this.next() * 100 < pct;
  }

  /** Independent child RNG (for sub-systems that must not perturb the main stream). */
  fork(salt = 0) {
    return new Rng((this.seed * 2654435761 + salt * 97 + this.int(0, 1e9)) >>> 0);
  }

  getState() {
    return this.state;
  }

  setState(s) {
    this.state = s >>> 0;
  }
}

const DICE_RE = /^\s*(\d*)d(\d+|%)\s*(?:([+-])\s*(\d+))?\s*(?:x\s*(\d+))?\s*$/i;

/**
 * Parse "3d6", "1d8+1", "d20", "2d4-1", "1d%" , "1d6x10" or a plain number.
 * @param {string|number} expr
 * @returns {{count:number, sides:number, mod:number, mult:number}}
 */
export function parseDice(expr) {
  if (typeof expr === 'number') return { count: 0, sides: 0, mod: expr, mult: 1 };
  const s = String(expr).trim();
  if (/^[+-]?\d+$/.test(s)) return { count: 0, sides: 0, mod: Number(s), mult: 1 };
  const m = DICE_RE.exec(s);
  if (!m) throw new Error(`Bad dice expression: ${expr}`);
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = m[2] === '%' ? 100 : Number(m[2]);
  const mod = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  const mult = m[5] ? Number(m[5]) : 1;
  return { count, sides, mod, mult };
}

/**
 * Roll a dice expression.
 * @param {Rng} rng
 * @param {string|number} expr
 * @returns {number}
 */
export function roll(rng, expr) {
  const { count, sides, mod, mult } = parseDice(expr);
  let total = 0;
  for (let i = 0; i < count; i++) total += rng.die(sides);
  return (total + mod) * mult;
}

/** Roll and return the individual dice as well. */
export function rollDetailed(rng, expr) {
  const { count, sides, mod, mult } = parseDice(expr);
  const dice = [];
  for (let i = 0; i < count; i++) dice.push(rng.die(sides));
  const total = (dice.reduce((a, b) => a + b, 0) + mod) * mult;
  return { total, dice, mod, mult };
}

/** Min/max/average for UI tooltips. */
export function diceStats(expr) {
  const { count, sides, mod, mult } = parseDice(expr);
  return {
    min: (count + mod) * mult,
    max: (count * sides + mod) * mult,
    avg: (count * (sides + 1) / 2 + mod) * mult,
  };
}
