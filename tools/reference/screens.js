/**
 * Recreations of the 1988 EGA Pool of Radiance screens (from memory of the
 * original): 320x200, 16 colours, 8x8 character grid, blue double-line frame,
 * small first-person viewport top-left, party list right, text below, command
 * line at the bottom. This is a COMPARISON BASELINE — do not beautify it.
 */
import { EGA } from '../../src/render/palette.js';
import { getMap } from '../../src/data/maps/index.js';
import { EDGE, DIR_VEC, turnLeft, turnRight } from '../../src/data/maps/MapGrid.js';
import { buildParty } from '../../src/rules/party.js';
import { deriveStats } from '../../src/rules/character.js';
import { getEncounter } from '../../src/data/encounters.js';
import { SHOPS } from '../../src/data/shops.js';
import { ITEMS } from '../../src/data/items.js';
import { Rng } from '../../src/rules/dice.js';
import { formatStr } from '../../src/rules/abilities.js';

const C = EGA;
const FRAME = C.lightBlue;
const VIEW = { x: 8, y: 8, w: 88, h: 88 };

/** Gold Box outer frame + the viewport box + horizontal divider. */
function standardFrame(e) {
  const f = (x, y, w, h) => {
    e.frame(x, y, w, h, FRAME);
    e.frame(x + 2, y + 2, w - 4, h - 4, C.blue);
  };
  f(0, 0, 320, 191);
  f(VIEW.x - 4, VIEW.y - 4, VIEW.w + 8, VIEW.h + 8);
  e.rect(3, 114, 314, 1, FRAME);
}

function commandLine(e, words, row = 24) {
  let x = 1;
  e.rect(0, row * 8 - 1, 320, 9, C.black);
  for (const w of words) {
    e.textAt(x, row, w[0], C.yellow);
    e.textAt(x + 1, row, w.slice(1), C.white);
    x += w.length + 1;
  }
}

function partyList(e, party) {
  e.textAt(14, 2, 'NAME', C.white);
  e.textAt(31, 2, 'AC', C.white);
  e.textAt(35, 2, 'HP', C.white);
  party.forEach((ch, i) => {
    const s = deriveStats(ch);
    const col = ch.status !== 'ok' ? C.lightRed : i === 0 ? C.white : C.lightGreen;
    e.textAt(14, 4 + i, ch.name.toUpperCase().slice(0, 15), col);
    e.textAt(31, 4 + i, String(s.ac).padStart(2), col);
    e.textAt(35, 4 + i, String(ch.hp.cur).padStart(3), col);
  });
}

/** First-person wire/flat EGA view of the grid map, Gold Box style. */
function drawView(e, map, px, py, dir, hour = 8) {
  e.clip = [VIEW.x, VIEW.y, VIEW.x + VIEW.w, VIEW.y + VIEW.h];
  e.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h, C.black);
  // sky & ground bands (city)
  const night = hour < 6 || hour > 19; // the EGA original simply blacks out the sky at night
  e.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h / 2, night ? C.black : C.blue);
  e.rect(VIEW.x, VIEW.y + VIEW.h / 2, VIEW.w, VIEW.h / 2, C.darkGray);
  const cx = VIEW.x + VIEW.w / 2;
  const cy = VIEW.y + VIEW.h / 2;
  const F = 88;
  const proj = (X, Y, Z) => [cx + (X / Z) * F, cy - (Y / Z) * F];
  const [fx, fy] = DIR_VEC[dir];
  const [rx, ry] = DIR_VEC[turnRight(dir)];
  const L = turnLeft(dir);
  const R = turnRight(dir);
  const quad = (pts, type, side) => {
    const base = side ? C.darkGray : C.lightGray;
    const mortar = side ? C.black : C.darkGray;
    const [a, b, c, d] = pts; // tl, tr, br, bl
    if (type === EDGE.ARCH) {
      // only draw posts + lintel
      const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      e.poly([a, lerp(a, b, 0.2), lerp(d, c, 0.2), d], base);
      e.poly([lerp(a, b, 0.8), b, c, lerp(d, c, 0.8)], base);
      e.poly([a, b, lerp(b, c, 0.18), lerp(a, d, 0.18)], base);
      return;
    }
    e.poly(pts, base);
    // brick courses
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      const l = lerp(a, d, t);
      const r = lerp(b, c, t);
      e.line(l[0], l[1], r[0], r[1], mortar);
      for (let m = 0; m < 3; m++) {
        const u = (m + (k % 2 ? 0.5 : 0)) / 3;
        if (u <= 0 || u >= 1) continue;
        const top = lerp(lerp(a, d, (k - 1) / 6), lerp(b, c, (k - 1) / 6), u);
        const bot = lerp(l, r, u);
        e.line(top[0], top[1], bot[0], bot[1], mortar);
      }
    }
    e.line(a[0], a[1], b[0], b[1], C.black);
    e.line(b[0], b[1], c[0], c[1], C.black);
    e.line(c[0], c[1], d[0], d[1], C.black);
    e.line(d[0], d[1], a[0], a[1], C.black);
    if (type === EDGE.DOOR || type === EDGE.LOCKED) {
      const dp = [lerp(lerp(a, b, 0.28), lerp(d, c, 0.28), 0.3), lerp(lerp(a, b, 0.72), lerp(d, c, 0.72), 0.3), lerp(d, c, 0.72), lerp(d, c, 0.28)];
      e.poly(dp, C.brown);
      e.line(dp[0][0], dp[0][1], dp[1][0], dp[1][1], C.black);
      e.line(dp[1][0], dp[1][1], dp[2][0], dp[2][1], C.black);
      e.line(dp[3][0], dp[3][1], dp[0][0], dp[0][1], C.black);
      const kn = lerp(dp[1], dp[2], 0.55);
      e.pset(kn[0] - 2, kn[1], C.yellow);
    }
  };
  for (let d = 3; d >= 0; d--) {
    for (const l of [-2, 2, -1, 1, 0]) {
      const x = px + fx * d + rx * l;
      const y = py + fy * d + ry * l;
      if (!map.inBounds(x, y)) continue;
      const z0 = d;
      const z1 = d + 1;
      const xl = l - 0.5;
      const xr = l + 0.5;
      const front = map.getEdge(x, y, dir);
      if (front !== EDGE.OPEN) {
        quad([proj(xl, 0.5, z1), proj(xr, 0.5, z1), proj(xr, -0.5, z1), proj(xl, -0.5, z1)], front === EDGE.SECRET ? EDGE.WALL : front, false);
      }
      const zn = Math.max(z0, 0.3);
      if (l <= 0) {
        const re = map.getEdge(x, y, R);
        if (re !== EDGE.OPEN && l < 0) quad([proj(xr, 0.5, zn), proj(xr, 0.5, z1), proj(xr, -0.5, z1), proj(xr, -0.5, zn)], re === EDGE.SECRET ? EDGE.WALL : re, true);
        const le = map.getEdge(x, y, L);
        if (le !== EDGE.OPEN && l === 0) quad([proj(xl, 0.5, zn), proj(xl, 0.5, z1), proj(xl, -0.5, z1), proj(xl, -0.5, zn)], le === EDGE.SECRET ? EDGE.WALL : le, true);
      }
      if (l >= 0) {
        const le = map.getEdge(x, y, L);
        if (le !== EDGE.OPEN && l > 0) quad([proj(xl, 0.5, z1), proj(xl, 0.5, zn), proj(xl, -0.5, zn), proj(xl, -0.5, z1)], le === EDGE.SECRET ? EDGE.WALL : le, true);
        const re = map.getEdge(x, y, R);
        if (re !== EDGE.OPEN && l === 0) quad([proj(xr, 0.5, z1), proj(xr, 0.5, zn), proj(xr, -0.5, zn), proj(xr, -0.5, z1)], re === EDGE.SECRET ? EDGE.WALL : re, true);
      }
    }
  }
  e.clip = null;
}

function paramsOf(q) {
  return {
    map: q.get('map') ?? 'phlan_slums',
    x: Number(q.get('x') ?? 7),
    y: Number(q.get('y') ?? 11),
    dir: q.get('dir') ?? 'N',
    hour: Math.floor(Number(q.get('hour') ?? 8)) % 24,
    encounter: q.get('encounter') ?? 'kobolds_1',
    shop: q.get('shop') ?? 'phlan_armory',
  };
}

export const SCREENS = {
  explore(e, q) {
    const p = paramsOf(q);
    const map = getMap(p.map);
    const party = buildParty('default', 1);
    e.cls(C.black);
    standardFrame(e);
    drawView(e, map, p.x, p.y, p.dir, p.hour);
    partyList(e, party);
    e.textAt(1, 13, `${p.x},${p.y} ${p.dir} ${p.hour}:00`, C.white);
    e.textAt(14, 13, 'SEARCH OFF', C.white);
    e.textAt(1, 16, map.zoneAt(p.x, p.y).toUpperCase(), C.lightCyan);
    e.textAt(1, 18, 'THE STREETS ARE STREWN WITH', C.white);
    e.textAt(1, 19, 'RUBBLE AND DEBRIS.', C.white);
    commandLine(e, ['AREA', 'CAST', 'VIEW', 'ENCAMP', 'SEARCH', 'LOOK']);
  },

  automap(e, q) {
    const p = paramsOf(q);
    const map = getMap(p.map);
    e.cls(C.black);
    e.frame(0, 0, 320, 200, FRAME);
    e.frame(2, 2, 316, 196, C.blue);
    const cs = 11;
    const ox = (320 - map.w * cs) / 2;
    const oy = 8;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const X = ox + x * cs;
      const Y = oy + y * cs;
      e.pset(X, Y, C.darkGray);
      const draw = (dir, x0, y0, x1, y1) => {
        const t = map.getEdge(x, y, dir);
        if (t === EDGE.OPEN) return;
        const col = t === EDGE.DOOR || t === EDGE.LOCKED ? C.brown : t === EDGE.ARCH ? C.cyan : C.lightCyan;
        e.line(x0, y0, x1, y1, col);
      };
      draw('N', X, Y, X + cs, Y);
      draw('W', X, Y, X, Y + cs);
      if (x === map.w - 1) draw('E', X + cs, Y, X + cs, Y + cs);
      if (y === map.h - 1) draw('S', X, Y + cs, X + cs, Y + cs);
    }
    const X = ox + p.x * cs + 5;
    const Y = oy + p.y * cs + 5;
    const arrows = { N: [[0, -3], [-3, 2], [3, 2]], S: [[0, 3], [-3, -2], [3, -2]], E: [[3, 0], [-2, -3], [-2, 3]], W: [[-3, 0], [2, -3], [2, 3]] };
    e.poly(arrows[p.dir].map(([dx, dy]) => [X + dx, Y + dy]), C.white);
    commandLine(e, ['EXIT']);
  },

  combat(e, q) {
    const p = paramsOf(q);
    const enc = getEncounter(p.encounter);
    const party = buildParty('default', 1);
    e.cls(C.black);
    // battlefield 13x11 tiles of 16px at (0,0)
    const T = 16;
    for (let ty = 0; ty < 11; ty++) for (let tx = 0; tx < 13; tx++) {
      const X = tx * T;
      const Y = ty * T;
      if (ty === 0 || (tx === 6 && ty === 2) || (tx === 7 && ty === 2)) {
        // brick wall tile
        e.rect(X, Y, T, T, C.red);
        for (let r = 0; r < 4; r++) {
          e.rect(X, Y + r * 4 + 3, T, 1, C.darkGray);
          for (let k = 0; k < 2; k++) e.rect(X + ((r % 2) * 4 + k * 8) % T, Y + r * 4, 1, 3, C.darkGray);
        }
      } else {
        // cobblestone tile
        e.rect(X, Y, T, T, C.darkGray);
        const rng = new Rng(tx * 97 + ty * 13 + 1);
        for (let k = 0; k < 5; k++) {
          const sx = X + rng.int(1, 12);
          const sy = Y + rng.int(1, 12);
          e.rect(sx, sy, 3, 2, C.lightGray);
          e.pset(sx + 3, sy + 1, C.black);
        }
      }
    }
    const HERO = [
      '.....yyy.....',
      '....yhhhy....',
      '....hhhhh....',
      '.....hhh.....',
      '...bbbbbbb...',
      '..bbbbbbbbw..',
      '..hbbbbbb.w..',
      '..h.bbbbb.w..',
      '....bbbbb.w..',
      '....bb.bb....',
      '....bb.bb....',
      '...ggg.ggg...',
    ];
    const KOBOLD = [
      '.............',
      '.............',
      '....gg.......',
      '...gggg......',
      '...grgg......',
      '....ggg..w...',
      '..nnnnnn.w...',
      '..gnnnnngw...',
      '...nnnn..w...',
      '...g..g......',
      '...g..g......',
      '..gg..gg.....',
    ];
    const heroCols = [C.lightBlue, C.lightRed, C.lightGreen, C.lightMagenta, C.yellow, C.lightCyan];
    party.forEach((ch, i) => {
      const tx = 2 + (i % 2);
      const ty = 2 + Math.floor(i / 2) * 2 + (i % 2);
      e.sprite(tx * T + 1, ty * T + 2, HERO, { y: C.yellow, h: C.lightRed, b: heroCols[i], w: C.white, g: C.brown });
    });
    const n = enc.groups.reduce((t, g) => t + (typeof g.count === 'number' ? g.count : 4), 0);
    for (let i = 0; i < n; i++) {
      const tx = 10 + (i % 3);
      const ty = 1 + Math.floor(i / 3) * 2 + (i % 3 === 1 ? 1 : 0);
      e.sprite(tx * T + 1, ty * T + 2, KOBOLD, { g: C.green, r: C.lightRed, n: C.brown, w: C.lightGray }, 1, true);
    }
    // cursor box on active
    e.frame(2 * T, 2 * T, T, T, C.yellow);
    // right panel
    e.rect(208, 0, 112, 176, C.black);
    e.frame(208, 0, 112, 176, FRAME);
    const ch = party[0];
    const s = deriveStats(ch);
    e.text(214, 6, ch.name.toUpperCase().slice(0, 12), C.lightGreen);
    e.text(214, 22, `HITPOINTS ${ch.hp.cur}`, C.white);
    e.text(214, 32, `AC ${s.ac}`, C.white);
    e.text(214, 48, s.weapon ? s.weapon.name.toUpperCase().slice(0, 12) : 'NONE', C.white);
    e.text(214, 70, 'MOVES LEFT 6', C.white);
    e.text(2, 178, `${enc.groups[0].count} ${enc.groups[0].monster.toUpperCase()}S ATTACK!`, C.white);
    commandLine(e, ['MOVE', 'AIM', 'USE', 'CAST', 'GUARD', 'QUICK', 'END']);
  },

  title(e) {
    e.cls(C.black);
    const rng = new Rng(42);
    for (let i = 0; i < 90; i++) e.pset(rng.int(0, 319), rng.int(0, 110), rng.chance(30) ? C.white : C.lightGray);
    // Phlan skyline
    let x = 0;
    while (x < 320) {
      const w = rng.int(10, 26);
      const h = rng.int(18, 60);
      e.rect(x, 150 - h, w, h + 50, C.blue);
      if (rng.chance(50)) e.poly([[x, 150 - h], [x + w / 2, 150 - h - rng.int(6, 14)], [x + w, 150 - h]], C.blue);
      for (let k = 0; k < 3; k++) if (rng.chance(40)) e.rect(x + rng.int(2, w - 4), 150 - h + rng.int(4, h - 4), 2, 3, C.yellow);
      x += w;
    }
    e.rect(0, 150, 320, 50, C.darkGray);
    e.dither(0, 150, 320, 6, C.darkGray, C.black);
    // the glowing pool
    for (let r = 44; r > 0; r -= 2) {
      const col = r > 34 ? C.blue : r > 24 ? C.cyan : r > 12 ? C.lightCyan : C.white;
      e.poly(Array.from({ length: 24 }, (_, i) => [160 + Math.cos((i / 24) * Math.PI * 2) * r * 1.6, 172 + Math.sin((i / 24) * Math.PI * 2) * r * 0.35]), col);
    }
    e.text(40, 10, 'ADVANCED DUNGEONS & DRAGONS', C.lightRed);
    const title = 'POOL OF RADIANCE';
    const tx = (320 - title.length * 16) / 2;
    e.text(tx + 1, 34 + 1, title, C.red, { scale: 2 });
    e.text(tx, 34, title, C.yellow, { scale: 2 });
    e.text(84, 60, 'FORGOTTEN REALMS', C.lightCyan);
    e.text(52, 186, 'STRATEGIC SIMULATIONS, INC.', C.white);
  },

  create(e) {
    const rng = new Rng(3);
    void rng;
    const ch = buildParty('default', 1)[0];
    const s = deriveStats(ch);
    const a = ch.abilities;
    e.cls(C.black);
    e.frame(0, 0, 320, 200, FRAME);
    e.frame(2, 2, 316, 196, C.blue);
    e.textAt(2, 2, ch.name.toUpperCase(), C.lightGreen);
    e.textAt(2, 4, 'HUMAN MALE', C.white);
    e.textAt(2, 5, 'FIGHTER', C.white);
    e.textAt(2, 6, 'LAWFUL GOOD', C.white);
    e.textAt(24, 4, `AGE ${ch.age}`, C.white);
    e.textAt(24, 5, `LEVEL ${s.levels}`, C.white);
    e.textAt(24, 6, `EXP ${ch.xp.fighter}`, C.white);
    const rows = [['STR', formatStr(a.str, a.strPct)], ['INT', a.int], ['WIS', a.wis], ['DEX', a.dex], ['CON', a.con], ['CHA', a.cha]];
    rows.forEach(([k, v], i) => {
      e.textAt(2, 9 + i, k, C.white);
      e.textAt(7, 9 + i, String(v), C.yellow);
    });
    e.textAt(18, 9, 'HIT POINTS', C.white);
    e.textAt(30, 9, String(ch.hp.max), C.yellow);
    e.textAt(18, 10, 'ARMOR CLASS', C.white);
    e.textAt(30, 10, String(s.ac), C.yellow);
    e.textAt(18, 11, 'THAC0', C.white);
    e.textAt(30, 11, String(s.thac0), C.yellow);
    e.textAt(18, 12, 'DAMAGE', C.white);
    e.textAt(30, 12, s.damage, C.yellow);
    e.textAt(2, 17, 'REROLL STATS?', C.white);
    commandLine(e, ['YES', 'NO', 'EXIT'], 22);
  },

  camp(e) {
    const party = buildParty('default', 1);
    e.cls(C.black);
    standardFrame(e);
    // campfire picture in the viewport
    e.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h, C.black);
    const cx = VIEW.x + 44;
    e.rect(cx - 20, 82, 40, 4, C.brown);
    e.poly([[cx - 12, 82], [cx, 50], [cx + 12, 82]], C.red);
    e.poly([[cx - 8, 82], [cx, 58], [cx + 8, 82]], C.lightRed);
    e.poly([[cx - 4, 82], [cx, 66], [cx + 4, 82]], C.yellow);
    partyList(e, party);
    e.textAt(1, 16, 'THE PARTY MAKES CAMP.', C.white);
    commandLine(e, ['SAVE', 'VIEW', 'MAGIC', 'REST', 'ALTER', 'FIX', 'EXIT']);
  },

  dialogue(e, q) {
    const p = paramsOf(q);
    const enc = getEncounter(p.encounter);
    const party = buildParty('default', 1);
    e.cls(C.black);
    standardFrame(e);
    e.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h, C.darkGray);
    e.rect(VIEW.x, VIEW.y, VIEW.w, 40, C.blue);
    const K = [
      '......gggg......',
      '.....gggggg.....',
      '....ggrggrgg....',
      '....gggggggg....',
      '.....gwwwwg.....',
      '......gggg......',
      '...nnnnnnnnnn...',
      '..gnnnnnnnnnng..',
      '..g.nnnnnnnn.g..',
      '..g.nnnnnnnn.gw.',
      '....nnnnnnnn..w.',
      '....gg....gg..w.',
      '....gg....gg....',
      '...ggg....ggg...',
    ];
    const map = { g: C.green, r: C.lightRed, w: C.lightGray, n: C.brown };
    e.clip = [VIEW.x, VIEW.y, VIEW.x + VIEW.w, VIEW.y + VIEW.h];
    e.sprite(VIEW.x + 12, VIEW.y + 34, K, map, 2);
    e.sprite(VIEW.x + 50, VIEW.y + 40, K, map, 2);
    e.clip = null;
    partyList(e, party);
    const n = enc.groups[0].count;
    e.textAt(1, 16, `YOU SEE ${n} KOBOLDS.`, C.white);
    e.textAt(1, 18, 'THEY RAISE THEIR WEAPONS.', C.white);
    commandLine(e, ['COMBAT', 'WAIT', 'FLEE', 'PARLAY']);
  },

  shop(e, q) {
    const p = paramsOf(q);
    const shop = SHOPS[p.shop];
    const party = buildParty('default', 1);
    e.cls(C.black);
    e.frame(0, 0, 320, 200, FRAME);
    e.frame(2, 2, 316, 196, C.blue);
    e.textAt(2, 1, shop.name.toUpperCase().slice(0, 36), C.lightCyan);
    e.textAt(2, 3, 'ITEM', C.white);
    e.textAt(30, 3, 'COST', C.white);
    // Taverns and training halls carry no stock: the 1988 menus listed their services instead.
    const rows = shop.stock?.length
      ? shop.stock.map((id) => [ITEMS[id]?.name ?? id, ITEMS[id]?.cost ?? 0])
      : shop.kind === 'tavern'
        ? [['ALE', shop.drink ?? 1], ['STEW', 2], ['RUMORS', 0]]
        : (shop.classes ?? []).map((c) => [`TRAIN ${c.replace(/([A-Z])/g, '-$1')}`, shop.cost ?? 1000]);
    rows.slice(0, 16).forEach(([name, cost], i) => {
      e.textAt(2, 5 + i, String(name).toUpperCase().slice(0, 24), C.lightGreen);
      e.textAt(30, 5 + i, String(cost).padStart(5), C.lightGreen);
    });
    e.textAt(2, 22, `${party[0].name.toUpperCase()} HAS ${party[0].gold} GOLD`, C.white);
    commandLine(e, ['BUY', 'SELL', 'VIEW', 'TAKE', 'POOL', 'EXIT']);
  },
};

// Party workstream screens (creation, ENCAMP, VIEW, ITEMS, MEMORIZE).
import { PARTY_SCREENS } from './partyScreens.js';
Object.assign(SCREENS, PARTY_SCREENS);
