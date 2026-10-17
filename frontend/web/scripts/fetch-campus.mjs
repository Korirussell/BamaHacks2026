// Fetch UA campus geometry from OpenStreetMap (Overpass) and save projected JSON.
// Run once: node scripts/fetch-campus.mjs  (output is committed so the demo never depends on Overpass)
import { writeFileSync } from 'node:fs';

const [S, W, N, E] = [33.2040, -87.5560, 33.2200, -87.5320];
const lat0 = (S + N) / 2, lng0 = (W + E) / 2;
const K = Math.cos((lat0 * Math.PI) / 180);
const proj = ([lng, lat]) => [+((lng - lng0) * 111320 * K).toFixed(1), +(-(lat - lat0) * 110540).toFixed(1)];

const bbox = `${S},${W},${N},${E}`;
// Separate light queries (one heavy union query gets 5xx from public Overpass).
const QUERIES = [
  `way["building"](${bbox});`,
  `way["highway"~"^(footway|pedestrian|service|residential|tertiary|secondary|primary)$"](${bbox});`,
  `(way["leisure"~"^(park|pitch|stadium)$"](${bbox});way["landuse"="grass"](${bbox});way["natural"="water"](${bbox}););`,
];
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(`[out:json][timeout:50];${body}out geom;`), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'handoff-hackathon-demo/1.0 (BamaHacks 2026)' } });
        if (!r.ok) throw new Error(r.status);
        return (await r.json()).elements;
      } catch (e) { console.error('Overpass failed', url, e.message); }
    }
    await sleep(3000);
  }
  return null;
}
const data = { elements: [] };
for (const q of QUERIES) {
  const els = await run(q);
  if (!els) { console.error('giving up on', q); if (q === QUERIES[0]) process.exit(1); continue; }
  data.elements.push(...els);
}

const heightOf = t => {
  if (t.height) return Math.min(60, parseFloat(t.height) || 10);
  if (t['building:levels']) return Math.min(60, parseFloat(t['building:levels']) * 3.6);
  return 10;
};
const buildings = [], roads = [], greens = [], water = [];
for (const el of data.elements) {
  const t = el.tags || {};
  const ring = el.type === 'way' ? el.geometry : el.members?.find(m => m.role === 'outer' && m.geometry)?.geometry;
  if (!ring || ring.length < 2) continue;
  const pts = ring.map(p => proj([p.lon, p.lat]));
  if (t.building) {
    let h = heightOf(t);
    const name = t.name || '';
    if (/bryant.?denny/i.test(name)) h = 45;
    if (/denny chimes/i.test(name)) h = 35;
    buildings.push({ id: el.id, name, h: +h.toFixed(1), pts });
  } else if (t.highway) {
    const w = { primary: 10, secondary: 9, tertiary: 8, residential: 6, service: 4, pedestrian: 5, footway: 3, path: 3 }[t.highway] || 3;
    roads.push({ w, pts });
  } else if (t.natural === 'water') water.push({ pts });
  else greens.push({ name: t.name || '', kind: t.leisure || t.landuse, pts });
}
const out = { center: [lng0, lat0], buildings, roads, greens, water };
writeFileSync(new URL('../public/campus/campus.json', import.meta.url), JSON.stringify(out));
console.log(`buildings ${buildings.length}, roads ${roads.length}, greens ${greens.length}, water ${water.length}`);
