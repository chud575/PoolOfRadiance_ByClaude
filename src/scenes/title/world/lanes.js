/**
 * Dragon flight lanes per mode (NDC x/y start→end, depth start→end): each sits
 * in sky the pose keeps clear of the logo and menus. Panels (settings, load,
 * credits) hide it so it never looms behind a frame.
 */
export const DRAGON = {
  // the card's hero pass: rising out from under the logo, banking across the
  // sun disc framed by the colonnade, then away toward the sea haze
  card: { x: [-0.42, -1.18], y: [0.29, 0.52], d: [125, 150], xe: 1, de: 2, period: 22, duty: 0.8, phase: 0.95, scale: 1.35, bank: -0.4 },
  menu: { x: [0.98, 0.7], y: [0.42, 0.36], d: [170, 210], xe: 1, de: 6, period: 20, duty: 0.75, phase: 4.5, scale: 1.25, bank: -0.62 },
};
