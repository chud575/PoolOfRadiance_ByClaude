/**
 * Dragon flight lanes per mode (NDC x/y start→end, depth start→end): each sits
 * in sky the pose keeps clear of the logo and menus. Panels (settings, load,
 * credits) hide it so it never looms behind a frame.
 */
export const DRAGON = {
  // the card's hero pass: in from the right over the Moonsea, low across the
  // bright sunset band between the lettering and the rooftops (backlit, its
  // membranes glowing), large and whole in frame, receding as it crosses
  card: { x: [1.18, -0.25], y: [-0.03, 0.08], d: [30, 45], xe: 1, de: 1.4, period: 26, duty: 0.72, phase: 4.6, scale: 0.72, bank: -0.22 },
  // (nearer the lens than any tower of the skyline, so the tail can never
  // thread behind a roof: the scale shrinks with the depth to keep its size)
  menu: { x: [1.15, -0.25], y: [0.0, 0.1], d: [28, 42], xe: 1, de: 1.4, period: 26, duty: 0.72, phase: 5.0, scale: 0.6, bank: -0.25 },
};
