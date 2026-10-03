/**
 * Dragon flight lanes per mode (NDC x/y start→end, depth start→end): each sits
 * in sky the pose keeps clear of the logo and menus. Panels (settings, load,
 * credits) hide it so it never looms behind a frame.
 */
export const DRAGON = {
  // the card's hero pass: in from the right over the Moonsea, low across the
  // bright sunset band between the lettering and the rooftops (backlit, its
  // membranes glowing), large and whole in frame, receding as it crosses
  card: { x: [1.18, -0.25], y: [-0.03, 0.08], d: [44, 66], xe: 1, de: 1.4, period: 26, duty: 0.72, phase: 2.42, scale: 1.05, bank: -0.22 },
  menu: { x: [1.15, -0.05], y: [-0.02, 0.08], d: [44, 66], xe: 1, de: 1.4, period: 26, duty: 0.72, phase: 2.42, scale: 0.95, bank: -0.25 },
};
