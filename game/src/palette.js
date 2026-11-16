// The look plan: six structural values plus team and state accents. The same names are the
// CSS custom properties in index.html so the DOM HUD and the 3D world share one palette.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  ally: '#5fb3a1',
  hostile: '#e0604a',
  success: '#8fbf6a',
  danger: '#d6493f',
};

export function shade(name) {
  return PALETTE[name] ?? PALETTE.ink;
}

export const TEAM = {
  CT: 'ct',
  T: 't',
};

export const TEAM_LABEL = {
  ct: 'Wardens',
  t: 'Cinders',
};

export const TEAM_COLOR = {
  ct: PALETTE.ally,
  t: PALETTE.hostile,
};
