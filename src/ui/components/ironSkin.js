import './ironskin.css';

/**
 * The party screens' dark metal skin, drawn procedurally as nine-slice SVG border images:
 *   --iron-band    the outer frame (blackened iron band, twisted hemp-and-wire rope, corner studs)
 *   --bronze-band  the portrait frame (heavy cast dark bronze, twisted rope, corner bosses, inner bevel)
 * Each band is lit by one warm key from the upper left (the same torch that lights the portraits):
 * top and left runs catch it, bottom and right fall into shadow; bosses carry a hot specular.
 * Installed once as CSS custom properties on :root; ironskin.css uses them.
 */

const enc = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/**
 * One band as a 3x3 tile sheet. T = tile size (= border-image-slice), the edge tiles repeat (round).
 * Cross-section from the outer edge in: lip, outer bevel, groove, rope, groove, inner bevel, shadow lip.
 */
function band({ T, metal, rope, boss, rim = 0.06, ropeW = 0.42, inset = 0, gems = null, casting = false }) {
  const S = T * 3;
  const r0 = T * 0.22, r1 = r0 + T * ropeW; // rope span across the band
  const twist = (T * ropeW) * 0.9; // strand period along the run
  const strands = [];
  // a run along the top edge, x from T to 2T; strands are slanted lozenges shaded as a cylinder
  for (let x = T - twist; x < 2 * T + twist; x += twist / 2) {
    const a = x, b = x + twist * 0.62;
    strands.push(`<path d='M${a.toFixed(2)} ${r1} L${(a + twist * 0.55).toFixed(2)} ${r0} L${(b + twist * 0.55).toFixed(2)} ${r0} L${b.toFixed(2)} ${r1} Z' fill='url(#st)' stroke='${rope[3]}' stroke-width='${(T * 0.018).toFixed(2)}'/>`);
  }
  const edgeRun = `
    <rect x='${T}' y='0' width='${T}' height='${T}' fill='url(#mx)'/>
    <rect x='${T}' y='0' width='${T}' height='${T * rim}' fill='#000'/>
    <rect x='${T}' y='${T * rim}' width='${T}' height='${T * 0.05}' fill='${metal[0]}' opacity='.55'/>
    <rect x='${T}' y='${r0 - T * 0.045}' width='${T}' height='${r1 - r0 + T * 0.09}' fill='#050403'/>
    <g clip-path='url(#rc)'>${strands.join('')}</g>
    <rect x='${T}' y='${r0}' width='${T}' height='${r1 - r0}' fill='url(#cyl)'/>
    <rect x='${T}' y='${r1 + T * 0.06}' width='${T}' height='${T * 0.04}' fill='${metal[0]}' opacity='.5'/>
    <rect x='${T}' y='${T * 0.9}' width='${T}' height='${T * 0.1}' fill='#000' opacity='.9'/>
    <rect x='${T}' y='${T * 0.86}' width='${T}' height='${T * 0.04}' fill='${metal[0]}' opacity='.35'/>`;
  // runs for the four sides: the top run rotated about the sheet centre; light stays upper-left
  const c = S / 2;
  const side = (deg, light) => `<g transform='rotate(${deg} ${c} ${c})'>${edgeRun}</g>
    <g transform='rotate(${deg} ${c} ${c})'><rect x='${T}' y='0' width='${T}' height='${T}' fill='${light > 0 ? '#ffd9a0' : '#000'}' opacity='${Math.abs(light)}'/></g>`;
  const corner = (cx, cy, l, gi = 0) => {
    const R = T * (casting ? 0.3 : 0.36);
    // A sculpted corner casting: four leaf lobes on the diagonals and a raised collar round the boss,
    // the lobes shaded from the upper left and outlined in black so they read as cast relief.
    const lobes = casting ? [45, 135, 225, 315].map((a) => {
      const rad = (a * Math.PI) / 180;
      const lx = cx + Math.cos(rad) * T * 0.3, ly = cy + Math.sin(rad) * T * 0.3;
      const lit = Math.cos(rad - (225 * Math.PI) / 180);
      return `<ellipse cx='${lx.toFixed(2)}' cy='${ly.toFixed(2)}' rx='${(T * 0.2).toFixed(2)}' ry='${(T * 0.1).toFixed(2)}' transform='rotate(${a} ${lx.toFixed(2)} ${ly.toFixed(2)})' fill='url(#lb)' stroke='#000' stroke-opacity='.85' stroke-width='${(T * 0.025).toFixed(2)}'/>
      <ellipse cx='${lx.toFixed(2)}' cy='${ly.toFixed(2)}' rx='${(T * 0.2).toFixed(2)}' ry='${(T * 0.1).toFixed(2)}' transform='rotate(${a} ${lx.toFixed(2)} ${ly.toFixed(2)})' fill='${lit > 0 ? '#ffd9a0' : '#000'}' opacity='${(Math.abs(lit) * (lit > 0 ? 0.22 : 0.45)).toFixed(2)}'/>
      <path d='M${(cx + Math.cos(rad) * T * 0.16).toFixed(2)} ${(cy + Math.sin(rad) * T * 0.16).toFixed(2)} L${(cx + Math.cos(rad) * T * 0.46).toFixed(2)} ${(cy + Math.sin(rad) * T * 0.46).toFixed(2)}' stroke='#000' stroke-opacity='.6' stroke-width='${(T * 0.02).toFixed(2)}'/>`;
    }).join('') : '';
    const gem = gems ? gems[gi % gems.length] : null;
    return `<g>
      <rect x='${cx - T / 2}' y='${cy - T / 2}' width='${T}' height='${T}' fill='url(#mx)'/>
      <rect x='${cx - T / 2}' y='${cy - T / 2}' width='${T}' height='${T}' fill='${l > 0 ? '#ffd9a0' : '#000'}' opacity='${Math.abs(l)}'/>
      ${lobes}
      <circle cx='${cx + T * 0.04}' cy='${cy + T * 0.07}' r='${R * 1.08}' fill='#000' opacity='.75'/>
      <circle cx='${cx}' cy='${cy}' r='${R}' fill='url(#bs)'/>
      <circle cx='${cx}' cy='${cy}' r='${R * 0.66}' fill='none' stroke='#000' stroke-opacity='.6' stroke-width='${T * 0.03}'/>
      ${gem ? `<circle cx='${cx}' cy='${cy}' r='${R * 0.56}' fill='#000'/>
      <circle cx='${cx}' cy='${cy}' r='${R * 0.5}' fill='url(#gm${gi % gems.length})'/>
      <ellipse cx='${cx - R * 0.18}' cy='${cy - R * 0.22}' rx='${R * 0.16}' ry='${R * 0.09}' fill='#fff' opacity='.85' transform='rotate(-35 ${cx - R * 0.18} ${cy - R * 0.22})'/>` : `<circle cx='${cx}' cy='${cy}' r='${R * 0.62}' fill='url(#bs2)'/>
      <ellipse cx='${cx - R * 0.28}' cy='${cy - R * 0.32}' rx='${R * 0.22}' ry='${R * 0.14}' fill='${boss[0]}' opacity='.85' transform='rotate(-35 ${cx - R * 0.28} ${cy - R * 0.32})'/>`}
    </g>`;
  };
  const gemDefs = (gems ?? []).map((g, i) => `<radialGradient id='gm${i}' cx='.4' cy='.35' r='.7'><stop offset='0' stop-color='${g[0]}'/><stop offset='.45' stop-color='${g[1]}'/><stop offset='1' stop-color='${g[2]}'/></radialGradient>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${S}' height='${S}' viewBox='0 0 ${S} ${S}'>
  <defs>
    <linearGradient id='mx' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0' stop-color='${metal[1]}'/><stop offset='.5' stop-color='${metal[2]}'/><stop offset='1' stop-color='${metal[3]}'/>
    </linearGradient>
    <linearGradient id='st' x1='0' y1='0' x2='1' y2='0'>
      <stop offset='0' stop-color='${rope[2]}'/><stop offset='.35' stop-color='${rope[1]}'/><stop offset='.55' stop-color='${rope[0]}'/><stop offset='.8' stop-color='${rope[1]}'/><stop offset='1' stop-color='${rope[2]}'/>
    </linearGradient>
    <linearGradient id='cyl' x1='0' y1='0' x2='0' y2='1'>
      <stop offset='0' stop-color='#000' stop-opacity='.55'/><stop offset='.3' stop-color='#fff' stop-opacity='.10'/><stop offset='.42' stop-color='#ffe0b0' stop-opacity='.22'/><stop offset='.6' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.7'/>
    </linearGradient>
    <radialGradient id='bs' cx='.36' cy='.32' r='.75'>
      <stop offset='0' stop-color='${boss[0]}'/><stop offset='.25' stop-color='${boss[1]}'/><stop offset='.6' stop-color='${boss[2]}'/><stop offset='1' stop-color='${boss[3]}'/>
    </radialGradient>
    <radialGradient id='bs2' cx='.38' cy='.34' r='.8'>
      <stop offset='0' stop-color='${boss[1]}'/><stop offset='.5' stop-color='${boss[2]}'/><stop offset='1' stop-color='${boss[3]}'/>
    </radialGradient>
    <linearGradient id='lb' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${metal[0]}'/><stop offset='.35' stop-color='${metal[1]}'/><stop offset='1' stop-color='${metal[3]}'/></linearGradient>
    ${gemDefs}
    <clipPath id='rc'><rect x='${T}' y='${r0}' width='${T}' height='${r1 - r0}'/></clipPath>
  </defs>
  <rect width='${S}' height='${S}' fill='${metal[3]}'/>
  ${side(0, 0.10)}${side(90, -0.32)}${side(180, -0.45)}${side(270, 0.05)}
  ${corner(T / 2, T / 2, 0.12, 0)}${corner(S - T / 2, T / 2, -0.15, 1)}${corner(T / 2, S - T / 2, -0.2, 1)}${corner(S - T / 2, S - T / 2, -0.4, 0)}
  ${inset ? '' : ''}
</svg>`;
  return enc(svg);
}

let installed = false;
export function installIronSkin() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement.style;
  root.setProperty('--iron-band', band({
    T: 40,
    metal: ['#8a8378', '#3a3734', '#211f1d', '#0c0b0a'],
    rope: ['#8a6c48', '#4a3622', '#22170e', '#080503'],
    boss: ['#f4dcb4', '#8a6a46', '#3a2e22', '#0a0806'],
  }));
  root.setProperty('--bronze-band', band({
    T: 48, ropeW: 0.34, casting: true,
    // oxidised bronze: a near-black olive-brown body, brass only on the lit lips and boss edges
    metal: ['#b08a58', '#3a3224', '#1c1912', '#080706'],
    rope: ['#a88050', '#4e3a24', '#221a10', '#070504'],
    boss: ['#f0d6a8', '#8a6a40', '#3a2c1a', '#0a0704'],
    gems: [['#ffb0a0', '#a0201a', '#300606'], ['#b0d8ff', '#1e5a9a', '#06142a']],
  }));
}
installIronSkin();
