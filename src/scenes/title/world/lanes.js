/**
 * Dragon flight lanes per mode (NDC x/y start→end, depth start→end): each sits
 * in sky the pose keeps clear of the logo and menus. Panels (settings, load,
 * credits) hide it so it never looms behind a frame.
 */
export const DRAGON = {
  // the card's hero pass: in from the right over the Moonsea, gliding across
  // the open sky between the logo and the castle with slow deep wing beats,
  // climbing away before it ever reaches the lettering
  card: { x: [1.02, 0.56], y: [0.47, 0.63], d: [150, 175], xe: 1, de: 1.5, period: 24, duty: 0.7, phase: 3.24, scale: 1.75, bank: -0.25 },
  menu: { x: [0.99, 0.7], y: [0.5, 0.66], d: [150, 175], xe: 1, de: 1.5, period: 24, duty: 0.7, phase: 3.24, scale: 1.6, bank: -0.3 },
};
