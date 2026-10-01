/**
 * Dragon flight lanes per mode (NDC x/y start→end, depth start→end): each sits
 * in sky the pose keeps clear of the logo and menus. Panels (settings, load,
 * credits) hide it so it never looms behind a frame.
 */
export const DRAGON = {
  card: { x: [1.14, 0.72], y: [0.58, 0.54], d: [230, 270], xe: 1, de: 6, period: 20, duty: 0.75, phase: 4.5, scale: 1.45, bank: -0.62 },
  menu: { x: [1.05, 0.74], y: [0.5, 0.44], d: [230, 270], xe: 1, de: 6, period: 20, duty: 0.75, phase: 4.5, scale: 1.0, bank: -0.62 },
};
