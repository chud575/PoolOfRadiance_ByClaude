/**
 * Shared colour palettes.
 * EGA16 is the exact IBM EGA default 16-colour palette used by the 1988 original
 * (and by the reference renderer + classic mode quantiser).
 */
export const EGA16 = [
  '#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
  '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
];
export const EGA = {
  black: 0, blue: 1, green: 2, cyan: 3, red: 4, magenta: 5, brown: 6, lightGray: 7,
  darkGray: 8, lightBlue: 9, lightGreen: 10, lightCyan: 11, lightRed: 12, lightMagenta: 13, yellow: 14, white: 15,
};

/** Modern homage palette (UI + lighting keys). Keep in sync with ui/styles/ui.css. */
export const HOMAGE = {
  midnight: '#0b1026',
  deepBlue: '#132049',
  royal: '#1f3a7a',
  gilt: '#d8b25a',
  giltBright: '#f5d98b',
  giltDark: '#8a6a2a',
  parchment: '#efe2c0',
  ink: '#2a1d10',
  blood: '#9c2a24',
  radiance: '#8ff0ff',
  torch: '#ffb265',
  moon: '#9fb6ff',
};

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
