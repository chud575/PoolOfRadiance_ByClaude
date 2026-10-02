import { buildTTF } from './ttf.js';

/**
 * "PoR Book" — the UI's own typeface, written procedurally with a simulated
 * broad-edged pen (a Johnston-style humanist book hand with pen-made Roman
 * capitals). Every glyph is a set of skeleton strokes; the outline is the
 * Minkowski sweep of an angled rectangular nib along each stroke (one convex
 * hull per flattened segment, unioned by TrueType's non-zero fill), so stems,
 * hairlines and the diagonal stress all come from one pen, like a scribe's.
 * Old-style figures in the book face, lining tabular figures in 'PoR Figures',
 * a legacy kern table, and real italic/bold built from the same skeletons
 * (italic: steeper pen, slanted and condensed skeleton; bold: broader nib).
 * Pure code — no font files, no network.
 */

const EM = 1000;
const X = 480; // x-height
const CAP = 680;
const ASC = 735;
const DSC = -235;

// ---------- skeleton helpers ----------
/** Lowercase stem with a pen-made entry serif at the top. */
const st = (x, top = X, bot = 0) => `M ${x - 64} ${top - 40} L ${x} ${top} L ${x} ${bot}`;
/** Foot serif (lighter pen) centred on x at the baseline (or at y). */
const ft = (x, y = 0, l = 60, r = 60) => `n0.58 M ${x - l} ${y + 12} L ${x + r} ${y + 12}`;
/** Capital serifs. */
const cs = (x, y, l = 64, r = 64) => `n0.46 M ${x - l} ${y} L ${x + r} ${y}`;
const ct = (x, l, r) => cs(x, CAP - 12, l, r);
const cb = (x, l, r) => cs(x, 12, l, r);
const dot = (x, y) => `M ${x + 9} ${y - 22} L ${x - 9} ${y + 22}`;
const J = (...s) => s.filter(Boolean).join(' | ');
/** Comma-shaped mark: a pen dot with a tail; (x,y) = dot centre, dir = 1 tail down-left, -1 tail up-right. */
const comma = (x, y, dir = 1) => J(`n1.15 M ${x + 6} ${y - 14} L ${x - 6} ${y + 14}`, `n0.8 M ${x + 4 * dir} ${y - 4 * dir} C ${x + 2 * dir} ${y - 50 * dir} ${x - 18 * dir} ${y - 90 * dir} ${x - 52 * dir} ${y - 120 * dir}`);

/**
 * Glyph table: [skeleton, lsb, rsb]. Skeleton strokes are separated by '|';
 * commands M/L/C/Q, A cx cy rx ry a0 a1 (degrees), and an optional leading
 * nN (nib scale) per stroke.
 */
const G = {
  // ----- lowercase -----
  a: [J('M 118 404 C 160 462 222 488 290 486 C 368 484 410 440 410 360 L 410 60 C 410 22 428 4 462 14',
    'M 410 280 C 300 272 96 246 96 128 C 96 44 156 -6 234 -6 C 316 -6 380 38 410 96'), 34, 18],
  b: [J(st(92, ASC), 'M 92 352 C 150 448 224 488 296 486 C 410 484 476 384 476 240 C 476 92 400 -6 288 -6 C 208 -6 140 24 92 70'), 50, 34],
  c: [J('M 418 404 C 384 458 330 486 266 486 C 150 486 74 380 74 240 C 74 92 154 -6 270 -6 C 340 -6 392 26 428 82'), 34, 24],
  d: [J(`M 384 ${ASC - 40} L 448 ${ASC} L 448 70 C 448 24 466 4 500 14`, 'M 448 380 C 404 452 340 488 268 486 C 146 484 74 384 74 240 C 74 92 152 -6 262 -6 C 342 -6 408 34 448 98'), 34, 18],
  e: [J('M 78 262 L 430 262 C 432 400 362 486 262 486 C 146 486 74 380 74 240 C 74 92 154 -6 270 -6 C 340 -6 394 24 430 78'), 34, 24],
  f: [J('M 150 0 L 150 540 C 150 668 214 736 300 736 C 352 736 386 716 408 690', 'n0.8 M 56 466 L 318 466', ft(150, 0, 60, 70)), 26, 0],
  g: [J('M 438 486 L 438 -60 C 438 -176 360 -236 256 -236 C 180 -236 118 -212 82 -172', 'M 438 386 C 396 452 330 488 260 486 C 142 484 76 384 76 250 C 76 112 150 18 256 18 C 336 18 396 50 438 114'), 34, 36],
  h: [J(st(92, ASC), 'M 92 356 C 150 446 220 486 292 486 C 382 486 424 432 424 340 L 424 0', ft(92), ft(424)), 50, 50],
  i: [J(st(120), ft(120), dot(118, 650)), 48, 48],
  j: [J(st(150), `M 150 0 L 150 -112 C 150 -192 112 -236 46 -232`, dot(148, 650)), 20, 48],
  k: [J(st(92, ASC), 'M 412 470 L 104 214', 'M 212 300 L 432 6', ft(92), ft(440, 0, 46, 50), cs(412, 468, 50, 60)), 50, 20],
  l: [J(st(120, ASC), ft(120)), 48, 48],
  m: [J(st(80), 'M 80 364 C 124 448 174 486 228 486 C 304 486 334 432 334 350 L 334 0', 'M 334 364 C 378 448 428 486 482 486 C 560 486 590 432 590 350 L 590 0', ft(80), ft(334), ft(590)), 48, 50],
  n: [J(st(92), 'M 92 356 C 150 446 220 486 292 486 C 382 486 424 432 424 340 L 424 0', ft(92), ft(424)), 50, 50],
  o: [J('A 268 240 196 246 0 360'), 32, 32],
  p: [J(st(92), `M 92 0 L 92 ${DSC}`, ft(92, DSC), 'M 92 352 C 150 448 224 488 296 486 C 410 484 476 384 476 240 C 476 92 400 -6 288 -6 C 208 -6 140 24 92 70'), 50, 34],
  q: [J(`M 448 486 L 448 ${DSC}`, ft(448, DSC), 'M 448 380 C 404 452 340 488 268 486 C 146 484 74 384 74 240 C 74 92 152 -6 262 -6 C 342 -6 408 34 448 98'), 34, 50],
  r: [J(st(92), 'M 92 352 C 140 440 198 486 266 486 C 318 486 350 470 366 446', ft(92, 0, 56, 70)), 50, 10],
  s: [J('M 384 436 C 344 472 294 486 240 486 C 148 486 92 440 92 372 C 92 302 152 276 240 252 C 340 224 398 192 398 120 C 398 40 330 -6 236 -6 C 166 -6 108 14 70 54'), 40, 40],
  t: [J('M 98 560 L 142 640 L 142 112 C 142 32 182 -6 244 -6 C 292 -6 324 14 346 44', 'n0.8 M 52 466 L 312 466'), 30, 12],
  u: [J(st(92), 'M 92 486 L 92 146 C 92 56 140 -6 222 -6 C 300 -6 372 40 424 122', st(424), 'M 424 90 C 424 30 444 4 476 14'), 50, 30],
  v: [J('M 46 480 L 252 -6 L 458 480', cs(46, 468, 56, 52), cs(458, 468, 50, 50)), 18, 18],
  w: [J('M 36 480 L 198 -6 L 346 400 L 494 -6 L 656 480', cs(36, 468, 52, 50), cs(656, 468, 46, 50)), 18, 18],
  x: [J('M 74 480 L 420 0', 'M 418 480 L 76 0', cs(74, 468, 54, 50), cs(418, 468, 50, 50), cs(76, 12, 50, 50), cs(420, 12, 50, 56)), 20, 20],
  y: [J('M 50 480 L 266 18', 'M 456 480 L 200 -150 C 170 -210 124 -236 62 -226', cs(50, 468, 54, 50), cs(456, 468, 50, 50)), 18, 18],
  z: [J('M 84 470 L 84 480 L 420 480 L 82 0 L 430 0 L 430 20'), 40, 40],

  // ----- capitals -----
  A: [J('M 46 0 L 340 696 L 634 0', 'n0.8 M 172 236 L 508 236', cb(46, 58, 70), cb(634, 74, 70)), 6, 6],
  B: [J('M 92 680 L 92 0', 'M 92 680 L 300 680 C 420 680 472 620 472 520 C 472 420 402 366 290 366 L 92 366', 'M 290 366 C 432 366 504 300 504 188 C 504 70 422 0 290 0 L 92 0', ct(92, 70, 0), cb(92, 70, 0)), 30, 40],
  C: [J('M 610 556 C 560 646 476 692 380 692 C 202 692 78 548 78 340 C 78 132 202 -12 382 -12 C 486 -12 566 38 618 130', 'n0.46 M 612 560 L 616 650'), 34, 30],
  D: [J('M 92 680 L 92 0', 'M 92 680 L 286 680 C 490 680 606 540 606 340 C 606 140 490 0 286 0 L 92 0', ct(92, 70, 0), cb(92, 70, 0)), 30, 36],
  E: [J('M 92 680 L 92 0', 'M 92 680 L 448 680 L 452 590', 'n0.9 M 92 362 L 380 362', 'n0.46 M 380 410 L 380 314', 'M 92 0 L 470 0 L 476 104', ct(92, 70, 0), cb(92, 70, 0)), 30, 24],
  F: [J('M 92 680 L 92 0', 'M 92 680 L 448 680 L 452 590', 'n0.9 M 92 352 L 370 352', 'n0.46 M 370 400 L 370 304', ct(92, 70, 0), cb(92, 70, 74)), 30, 24],
  G: [J('M 610 556 C 560 646 476 692 380 692 C 202 692 78 548 78 340 C 78 132 202 -12 382 -12 C 486 -12 566 22 634 74 L 634 286', 'n0.46 M 612 560 L 616 650', cs(634, 286, 140, 56)), 34, 34],
  H: [J('M 92 680 L 92 0', 'M 610 680 L 610 0', 'n0.9 M 92 360 L 610 360', ct(92), cb(92), ct(610), cb(610)), 30, 30],
  I: [J('M 124 680 L 124 0', ct(124), cb(124)), 30, 30],
  J: [J('M 262 680 L 262 70 C 262 -24 210 -70 130 -70 C 86 -70 54 -58 30 -36', ct(262)), 10, 30],
  K: [J('M 92 680 L 92 0', 'M 548 680 L 106 280', 'M 232 400 L 582 0', ct(92), cb(92), ct(548, 70, 60), cb(582, 70, 60)), 30, 10],
  L: [J('M 92 680 L 92 0', 'M 92 0 L 480 0 L 486 108', ct(92), cb(92, 70, 0)), 30, 22],
  M: [J('M 96 680 L 82 0', 'M 96 680 L 384 -6 L 672 680 L 686 0', cb(82, 60, 64), ct(96, 70, 0), ct(672, 0, 70), cb(686)), 26, 26],
  N: [J('n0.62 M 92 680 L 92 0', 'M 92 680 L 596 0', 'n0.62 M 596 680 L 596 0', ct(92, 70, 0), cb(92), ct(596)), 30, 30],
  O: [J('A 384 340 310 352 0 360'), 32, 32],
  P: [J('M 92 680 L 92 0', 'M 92 680 L 304 680 C 446 680 506 610 506 500 C 506 390 436 318 304 318 L 92 318', ct(92, 70, 0), cb(92)), 30, 22],
  Q: [J('A 384 340 310 352 0 360', 'M 380 6 C 470 -54 580 -104 720 -136'), 32, 10],
  R: [J('M 92 680 L 92 0', 'M 92 680 L 304 680 C 446 680 506 610 506 500 C 506 390 436 324 304 324 L 92 324', 'M 270 324 L 560 0', ct(92, 70, 0), cb(92), cb(566, 50, 66)), 30, 14],
  S: [J('M 476 628 C 428 670 366 692 296 692 C 172 692 92 628 92 530 C 92 430 172 396 294 360 C 426 322 506 280 506 174 C 506 58 412 -12 292 -12 C 202 -12 122 18 70 70', 'n0.46 M 476 632 L 480 706', 'n0.46 M 70 66 L 66 -16'), 40, 40],
  T: [J('M 40 680 L 584 680', 'n0.46 M 42 680 L 38 590 | n0.46 M 582 680 L 586 590', 'M 312 680 L 312 0', cb(312)), 14, 14],
  U: [J('M 92 680 L 92 246 C 92 74 186 -12 336 -12 C 486 -12 578 74 578 246 L 578 680', ct(92), ct(578)), 26, 26],
  V: [J('M 36 680 L 330 -12 L 624 680', ct(36, 60, 70), ct(624, 70, 60)), 6, 6],
  W: [J('M 30 680 L 236 -10 L 440 610 L 644 -10 L 850 680', ct(30, 56, 70), ct(850, 70, 56)), 6, 6],
  X: [J('M 60 680 L 570 0', 'M 568 680 L 62 0', ct(60, 60, 70), ct(568, 70, 60), cb(62, 60, 70), cb(570, 70, 60)), 10, 10],
  Y: [J('M 40 680 L 312 340 L 584 680', 'M 312 340 L 312 0', ct(40, 56, 70), ct(584, 70, 56), cb(312)), 10, 10],
  Z: [J('M 84 586 L 88 680 L 528 680 L 84 0 L 548 0 L 552 106'), 34, 30],

  // ----- punctuation -----
  ' ': ['', 0, 250],
  '.': [dot(100, 24), 60, 60],
  ',': [comma(100, 30), 60, 60],
  ':': [J(dot(100, 24), dot(100, 430)), 60, 60],
  ';': [J(comma(100, 30), dot(104, 430)), 60, 60],
  '!': [J('M 120 690 L 118 200', dot(118, 24)), 60, 60],
  '?': [J('M 88 586 C 118 656 180 692 252 692 C 342 692 402 632 402 552 C 402 432 262 404 252 300 L 252 206', dot(252, 24)), 40, 40],
  "'": ['M 110 700 L 104 540', 60, 60],
  '"': [J('M 110 700 L 104 540', 'M 230 700 L 224 540'), 60, 60],
  '‘': [comma(126, 660, -1), 60, 60],
  '’': [comma(110, 680), 60, 60],
  '“': [J(comma(126, 660, -1), comma(256, 660, -1)), 60, 60],
  '”': [J(comma(110, 680), comma(240, 680)), 60, 60],
  '-': ['n0.85 M 60 250 L 290 250', 50, 50],
  '–': ['n0.8 M 40 260 L 470 260', 30, 30],
  '—': ['n0.8 M 40 260 L 930 260', 20, 20],
  '(': ['A 360 250 236 480 118 242', 50, 20],
  ')': ['A -60 250 236 480 62 -62', 20, 50],
  '[': ['M 210 730 L 100 730 L 100 -230 L 210 -230', 50, 20],
  ']': ['M 40 730 L 150 730 L 150 -230 L 40 -230', 20, 50],
  '/': ['M 50 -120 L 360 730', 10, 10],
  '\\': ['M 50 730 L 360 -120', 10, 10],
  '|': ['M 100 730 L 100 -230', 60, 60],
  '&': ['M 560 0 L 186 430 C 132 492 120 530 120 568 C 120 646 178 694 248 694 C 316 694 366 646 366 578 C 366 498 296 456 206 406 C 116 356 64 296 64 204 C 64 82 156 -10 278 -10 C 392 -10 478 64 580 300', 30, 20],
  '+': [J('M 60 280 L 420 280', 'M 240 100 L 240 460'), 40, 40],
  '=': [J('n0.8 M 60 350 L 420 350', 'n0.8 M 60 200 L 420 200'), 40, 40],
  '<': ['M 420 480 L 70 280 L 420 80', 40, 40],
  '>': ['M 70 480 L 420 280 L 70 80', 40, 40],
  '*': [J('M 220 700 L 220 470', 'M 120 650 L 320 520', 'M 120 520 L 320 650'), 40, 40],
  '#': [J('M 200 680 L 150 0', 'M 400 680 L 350 0', 'n0.8 M 80 460 L 470 460', 'n0.8 M 60 220 L 450 220'), 30, 30],
  '%': [J('A 160 560 90 130 0 360', 'A 470 120 90 130 0 360', 'M 520 690 L 110 -10'), 30, 30],
  '$': [J('M 384 560 C 344 600 294 614 240 614 C 148 614 92 568 92 496 C 92 420 152 392 240 366 C 340 336 400 302 400 222 C 400 136 330 86 236 86 C 166 86 108 108 70 150', 'n0.7 M 244 720 L 244 -10'), 40, 40],
  '@': [J('A 400 300 300 330 -30 330', 'M 500 420 L 470 180 C 466 130 490 110 520 120', 'A 390 280 120 140 0 360'), 30, 30],
  '_': ['n0.8 M 20 -120 L 500 -120', 0, 0],
  '~': ['M 60 260 C 120 340 180 340 240 280 C 300 220 360 220 420 300', 30, 30],
  '^': ['M 70 420 L 240 690 L 410 420', 30, 30],
  '`': ['M 80 700 L 180 600', 40, 40],
  '{': ['M 250 730 C 150 730 140 680 140 560 C 140 400 120 260 60 250 C 120 240 140 100 140 -60 C 140 -180 150 -230 250 -230', 40, 20],
  '}': ['M 40 730 C 140 730 150 680 150 560 C 150 400 170 260 230 250 C 170 240 150 100 150 -60 C 150 -180 140 -230 40 -230', 20, 40],
  '·': [dot(100, 300), 60, 60],
  '•': ['n2.2 M 120 270 L 128 290', 60, 60],
  '…': [J(dot(100, 24), dot(330, 24), dot(560, 24)), 60, 60],
  '×': [J('M 90 460 L 400 110', 'M 90 110 L 400 460'), 40, 40],
  '©': [J('A 380 340 300 340 0 360', 'M 500 450 C 470 500 430 520 380 520 C 290 520 230 440 230 340 C 230 240 290 160 380 160 C 430 160 470 180 500 230'), 30, 30],
};

/** Old-style figures (book face). [skeleton] — tabular: every figure gets the same advance. */
const OLDSTYLE = {
  0: 'A 262 244 128 252 0 360', // narrower than 'o' so THAC0 never reads THACo
  1: J('M 162 412 L 262 486 L 262 0', ft(262, 0, 80, 80)),
  2: 'M 96 380 C 128 450 186 486 254 486 C 344 486 402 432 402 352 C 402 252 302 172 86 0 L 436 0 L 440 60',
  3: 'M 104 420 C 144 464 194 486 252 486 C 340 486 392 434 392 362 C 392 290 334 246 242 246 C 352 246 424 180 424 70 C 424 -110 330 -236 214 -236 C 154 -236 106 -220 68 -188',
  4: J('M 356 -236 L 356 486 L 54 66 L 476 66', ft(356, -236, 70, 70)),
  5: 'M 418 486 L 156 486 L 126 254 C 172 278 214 288 262 288 C 384 288 444 198 444 62 C 444 -112 344 -236 210 -236 C 150 -236 102 -216 70 -184',
  6: 'M 412 694 C 362 724 304 738 254 734 C 142 724 82 566 82 334 C 82 104 152 -6 262 -6 C 372 -6 442 80 442 200 C 442 320 372 402 262 402 C 182 402 122 362 86 302',
  7: 'M 72 420 L 76 486 L 444 486 L 198 -236',
  8: J('M 262 400 C 180 400 126 470 126 562 C 126 664 186 734 262 734 C 338 734 398 664 398 562 C 398 470 344 400 262 400 C 160 400 82 320 82 196 C 82 76 160 -6 262 -6 C 364 -6 442 76 442 196 C 442 320 364 400 262 400'),
  9: 'M 112 -208 C 162 -238 220 -252 270 -248 C 382 -238 442 -80 442 152 C 442 382 372 486 262 486 C 152 486 82 400 82 280 C 82 160 152 78 262 78 C 342 78 402 118 438 178',
};
const OLD_RANGE = { 0: [0, X], 1: [0, X], 2: [0, X], 6: [0, ASC], 8: [0, ASC], 3: [DSC, X], 4: [DSC, X], 5: [DSC, X], 7: [DSC, X], 9: [DSC, X] };
const FIG_ADV = 524;
const FIG_PUNCT = ' .,:;/-+%()×·–—';

/** Kern pairs (design units, scaled for italic). */
const KERN = [
  ['A', 'V', -80], ['A', 'W', -60], ['A', 'Y', -70], ['A', 'T', -60], ['A', 'v', -40], ['A', 'w', -30], ['A', 'y', -40],
  ['L', 'T', -80], ['L', 'V', -80], ['L', 'W', -60], ['L', 'Y', -80],
  ['T', 'A', -60], ['T', 'a', -90], ['T', 'e', -90], ['T', 'o', -90], ['T', 'r', -60], ['T', 'u', -60], ['T', 'y', -60], ['T', 'w', -60], ['T', '.', -80], ['T', ',', -80],
  ['V', 'A', -80], ['V', 'a', -70], ['V', 'e', -70], ['V', 'o', -70], ['V', '.', -90], ['V', ',', -90],
  ['W', 'A', -60], ['W', 'a', -50], ['W', 'e', -50], ['W', 'o', -50], ['W', '.', -70], ['W', ',', -70],
  ['Y', 'A', -70], ['Y', 'a', -80], ['Y', 'e', -80], ['Y', 'o', -80], ['Y', '.', -90], ['Y', ',', -90],
  ['P', 'A', -50], ['P', '.', -100], ['P', ',', -100], ['F', '.', -80], ['F', ',', -80], ['F', 'A', -40],
  ['r', '.', -60], ['r', ',', -60], ['v', '.', -50], ['v', ',', -50], ['w', '.', -40], ['w', ',', -40], ['y', '.', -50], ['y', ',', -50],
  ['f', 'f', -20], ['f', '.', -30], ['f', ',', -30], ['f', '’', 40], ['f', 'o', -10],
  ['“', 'A', -50], ['A', '”', -50], ['‘', 'A', -50], ['A', '’', -50],
  ['o', 'v', -10], ['o', 'y', -10], ['v', 'o', -10], ['y', 'o', -10], ['k', 'o', -10], ['r', 'a', -10],
  ['O', 'V', -20], ['O', 'A', -20], ['V', 'O', -20], ['A', 'O', -20], ['O', 'T', -20], ['T', 'O', -20],
  ['R', 'V', -20], ['R', 'T', -20], ['R', 'Y', -30], ['K', 'O', -30],
];

// ---------- pen engine ----------
function parse(path) {
  const strokes = [];
  for (const part of path.split('|')) {
    const tk = part.trim().split(/[\s,]+/).filter(Boolean);
    if (!tk.length) continue;
    let nib = 1;
    if (/^n[\d.]+$/.test(tk[0])) nib = parseFloat(tk.shift().slice(1));
    const pts = [];
    let i = 0, cx = 0, cy = 0;
    const num = () => parseFloat(tk[i++]);
    const push = (x, y) => { pts.push([x, y]); cx = x; cy = y; };
    while (i < tk.length) {
      const c = tk[i++];
      if (c === 'M' || c === 'L') { push(num(), num()); }
      else if (c === 'C') {
        const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
        const len = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);
        const k = Math.max(4, Math.ceil(len / 14));
        const x0 = cx, y0 = cy;
        for (let s = 1; s <= k; s++) {
          const t = s / k, u = 1 - t;
          push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
        }
      } else if (c === 'A') {
        const acx = num(), acy = num(), rx = num(), ry = num(), a0 = num(), a1 = num();
        const len = Math.abs(a1 - a0) / 360 * Math.PI * (rx + ry);
        const k = Math.max(8, Math.ceil(len / 14));
        for (let s = 0; s <= k; s++) {
          const a = (a0 + (a1 - a0) * s / k) * Math.PI / 180;
          push(acx + rx * Math.cos(a), acy + ry * Math.sin(a));
        }
      } else throw new Error(`bookFace: bad path token ${c}`);
    }
    strokes.push({ nib, pts });
  }
  return strokes;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1)); // counter-clockwise
  return h.reverse(); // clockwise: TrueType outer contour
}

/**
 * Sweep the nib along every stroke.
 * @param {{nib:number, pts:number[][]}[]} strokes skeleton (already transformed)
 * @param {{w:number, h:number, angle:number}} pen
 */
function sweep(strokes, pen) {
  const out = [];
  const ca = Math.cos(pen.angle), sa = Math.sin(pen.angle);
  for (const s of strokes) {
    const a = pen.w * 0.5 * s.nib, b = pen.h * 0.5 * Math.min(1, 0.55 + 0.45 * s.nib);
    const nib = [[a, b], [a, -b], [-a, -b], [-a, b]].map(([u, v]) => [u * ca - v * sa, u * sa + v * ca]);
    const P = s.pts;
    const segs = P.length === 1 ? [[P[0], P[0]]] : P.slice(1).map((q, i) => [P[i], q]);
    for (const [p, q] of segs) {
      const pts = [];
      for (const [dx, dy] of nib) { pts.push([Math.round(p[0] + dx), Math.round(p[1] + dy)]); pts.push([Math.round(q[0] + dx), Math.round(q[1] + dy)]); }
      const h = hull(pts);
      if (h.length >= 3) out.push(h);
    }
  }
  return out;
}

function glyphOutline(skel, pen, xf) {
  const strokes = parse(skel).map((s) => ({ nib: s.nib, pts: s.pts.map(xf) }));
  return sweep(strokes, pen);
}

function bounds(contours) {
  let x0 = Infinity, x1 = -Infinity;
  for (const c of contours) for (const [x] of c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  return [x0, x1];
}
const shift = (contours, dx) => contours.map((c) => c.map(([x, y]) => [x + dx, y]));

/**
 * Build one face.
 * @param {{family:string, sub:string, bold?:boolean, italic?:boolean, lining?:boolean}} o
 */
export function buildBookTTF(o) {
  const bold = !!o.bold, italic = !!o.italic;
  const pen = {
    w: bold ? 142 : 104,
    h: bold ? 36 : 26,
    angle: ((italic ? 38 : 26) * Math.PI) / 180,
  };
  const slant = italic ? 0.2 : 0;
  const cond = italic ? 0.88 : 1;
  const widen = bold ? 1.04 : 1;
  const xf = ([x, y]) => [x * cond * widen, y];
  // slant after spacing: sidebearings are measured on the upright pen strokes,
  // so italic spacing stays even (a leaning 'f' does not push its neighbours away)
  const lean = (contours) => (slant ? contours.map((c) => c.map(([x, y]) => [Math.round(x + (y - X / 2) * slant), y])) : contours);
  const sbScale = italic ? 0.86 : bold ? 1.04 : 0.94;
  const glyphs = [];
  for (const [ch, [skel, l, r]] of Object.entries(G)) {
    if (o.lining && !FIG_PUNCT.includes(ch)) continue; // the figures face carries only numerals + their punctuation
    const cp = ch.codePointAt(0);
    const contours = skel ? glyphOutline(skel, pen, xf) : [];
    if (!contours.length) { glyphs.push({ cp, adv: Math.round(r * (italic ? 0.9 : 1)), contours: [] }); continue; }
    const [x0, x1] = bounds(contours);
    const lsb = Math.round(l * sbScale), rsb = Math.round(r * sbScale);
    glyphs.push({ cp, adv: x1 - x0 + lsb + rsb, contours: lean(shift(contours, lsb - x0)) });
  }
  // figures: tabular, centred
  for (const [d, skel] of Object.entries(OLDSTYLE)) {
    let xfd = xf;
    if (o.lining) {
      const [lo, hi] = OLD_RANGE[d];
      const k = 666 / (hi - lo);
      xfd = ([x, y]) => xf([x, (y - lo) * k]);
    }
    const contours = glyphOutline(skel, pen, xfd);
    const [x0, x1] = bounds(contours);
    const adv = Math.round(FIG_ADV * cond * (bold ? 1.06 : 1));
    glyphs.push({ cp: 48 + Number(d), adv, contours: lean(shift(contours, Math.round((adv - (x1 - x0)) / 2 - x0))) });
  }
  // no-break space = space
  const sp = glyphs.find((g) => g.cp === 32);
  glyphs.push({ cp: 0xa0, adv: sp.adv, contours: [] });
  const kk = italic ? 0.85 : 1;
  const kern = KERN.map(([a, b, v]) => [a.codePointAt(0), b.codePointAt(0), Math.round(v * kk)]);
  return buildTTF({
    family: o.family, sub: o.sub, em: EM, ascent: 900, descent: -270, italic, weight: bold ? 700 : 400,
    xHeight: X, capHeight: CAP, glyphs, kern,
  });
}

const FACES = [
  { sub: 'Regular', style: 'normal', weight: '400' },
  { sub: 'Italic', style: 'italic', weight: '400', italic: true },
  { sub: 'Bold', style: 'normal', weight: '700', bold: true },
  { sub: 'Bold Italic', style: 'italic', weight: '700', bold: true, italic: true },
];

let registered = null;
/**
 * Register 'PoR Book' (old-style figures) and 'PoR Figures' (lining tabular
 * figures, used for numbers in tables) with document.fonts. Idempotent.
 * @returns {Promise<void>|null}
 */
export function registerBookFonts() {
  if (registered || typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return registered;
  const jobs = [];
  for (const [family, lining] of [['PoR Book', false], ['PoR Figures', true]]) {
    for (const f of FACES) {
      try {
        const bytes = buildBookTTF({ family, sub: f.sub, bold: f.bold, italic: f.italic, lining });
        const face = new FontFace(family, bytes.buffer, { style: f.style, weight: f.weight });
        document.fonts.add(face);
        jobs.push(face.load().catch((e) => console.warn(`[skin] ${family} ${f.sub} rejected`, e?.message ?? e)));
      } catch (e) {
        console.warn('[skin] book face failed', e);
      }
    }
  }
  registered = Promise.all(jobs).then(() => undefined);
  return registered;
}
