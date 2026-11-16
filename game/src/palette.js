// The look plan, in one place. Six base values and the two team colours plus map
// materials; the lighting makes every shade the game needs, so no other colour appears
// in the code. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1c2127',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  // Teams: VANGUARD teal, HAVOC ember. Used for bot bodies, markers and HUD chips.
  vanguard: '#3fb6a8',
  havoc: '#e85d3d',
  // Map materials: concrete, rust steel, hazard paint.
  concrete: '#3a3f46',
  rust: '#7a4a33',
  hazard: '#d8a02c',
  crate: '#5a4632',
  container: '#2e5d6b',
};

export function shade(name) {
  return PALETTE[name];
}
