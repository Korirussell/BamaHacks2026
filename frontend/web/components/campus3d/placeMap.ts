// places.json id → real OSM building name (campus3d.md §3). Fallback coords are in local meters [x, z].
export const PLACE_MAP: Record<string, { name?: string; green?: string; fallback: [number, number]; offset?: [number, number] }> = {
  p_bevill: { name: 'tom bevill building', fallback: [33, -511] },
  p_rodgers: { name: 'rodgers library', fallback: [109, -174] },
  p_ferguson: { name: 'university of alabama student center', fallback: [-175, -278] }, // Ferguson Center, renamed
  p_shelby: { green: 'shelby quad', fallback: [150, -330], offset: [40, -20] },
  p_gorgas: { name: 'amelia gayle gorgas library', fallback: [-191, 37] },
  p_uapd: { fallback: [500, 160] },
  p_paty: { name: 'paty hall', fallback: [-254, -482] },
  p_ridgecrest: { name: 'ridgecrest east', fallback: [-390, -601] },
  p_locker_ridgecrest: { name: 'ridgecrest east', fallback: [-390, -601], offset: [28, 22] },
  p_locker_ferguson: { name: 'university of alabama student center', fallback: [-175, -278], offset: [30, 30] },
};

export const KEY_LABELS = [
  'amelia gayle gorgas library', 'university of alabama student center', 'rodgers library', 'tom bevill building', 'denny chimes',
  'paty hall', 'ridgecrest east', 'lloyd hall', 'tutwiler', 'reese phifer', 'bidgood hall', 'presidents hall',
];
export const LABEL_ALIAS: Record<string, string> = {
  'university of alabama student center': 'Ferguson Center',
  'amelia gayle gorgas library': 'Gorgas Library',
  'tom bevill building': 'Bevill Building',
  'ridgecrest east': 'Ridgecrest',
};
