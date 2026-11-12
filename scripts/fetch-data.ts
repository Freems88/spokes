/**
 * Build the cached data the site ships with:
 *   public/data/signals.geojson  Toronto traffic signals (Open Government Licence – Toronto)
 *   public/data/routes.geojson   default spoke + terminal routes, snapped by OSRM (bike profile + bearings)
 *
 *   npm run data              # both
 *   npm run data -- routes    # routes only
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_SCENARIO } from '../src/config';
import { TERMINAL_ID, spokeWaypoints, waypointsKey, type RoutesFile, type SignalsFile } from '../src/model/data';
import { routeVia } from '../src/model/routing';
import type { LngLat } from '../src/model/types';

const OUT = new URL('../public/data/', import.meta.url);
const SIGNALS_CSV =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1a106e88-f734-4179-b3fe-d690a6187a71/resource/aeda8fd7-e1d6-4d34-b62a-a7d6be10cc96/download';

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const title = (s: string | undefined) =>
  !s || s === 'None' ? '' : s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(St|Ave|Rd|Dr|Blvd|Cres)\b/g, '$1');

async function signals() {
  const res = await fetch(SIGNALS_CSV);
  if (!res.ok) throw new Error(`signals HTTP ${res.status}`);
  const [head, ...rows] = parseCsv(await res.text());
  const col = (n: string) => head!.indexOf(n);
  const [iPx, iMain, iSide1, iSide2, iGeo] = ['PX', 'MAIN_STREET', 'SIDE1_STREET', 'SIDE2_STREET', 'geometry'].map(col);
  const features: SignalsFile['features'] = [];
  for (const r of rows) {
    if (r.length < head!.length) continue;
    let pt: LngLat | undefined;
    try {
      const g = JSON.parse(r[iGeo!]!) as { type: string; coordinates: unknown };
      pt = (g.type === 'MultiPoint' ? (g.coordinates as LngLat[])[0] : (g.coordinates as LngLat)) ?? undefined;
    } catch { /* skip */ }
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    const name = [title(r[iMain!]), title(r[iSide1!]), title(r[iSide2!])].filter(Boolean).join(' / ');
    features.push({
      type: 'Feature',
      properties: { px: r[iPx!] ?? '', name },
      geometry: { type: 'Point', coordinates: [Math.round(pt[0] * 1e6) / 1e6, Math.round(pt[1] * 1e6) / 1e6] },
    });
  }
  const file: SignalsFile & { metadata: object } = {
    type: 'FeatureCollection',
    metadata: {
      source: 'City of Toronto Open Data: Traffic Signals Tabular',
      licence: 'Open Government Licence – Toronto',
      fetched: new Date().toISOString().slice(0, 10),
    },
    features,
  };
  await writeFile(new URL('signals.geojson', OUT), JSON.stringify(file));
  console.log(`signals: ${features.length} written`);
}

async function routes() {
  const ids = [...DEFAULT_SCENARIO.spokes.map((s) => s.id), TERMINAL_ID];
  const features: RoutesFile['features'] = [];
  for (const id of ids) {
    const wps = spokeWaypoints(DEFAULT_SCENARIO, id);
    const r = await routeVia(wps);
    console.log(`route ${id}: ${r.source}, detour ×${r.detourRatio.toFixed(2)}${r.error ? ` (${r.error})` : ''}`);
    features.push({
      type: 'Feature',
      properties: { id, source: r.source, detourRatio: Math.round(r.detourRatio * 1000) / 1000, waypointsKey: waypointsKey(wps) },
      geometry: { type: 'LineString', coordinates: r.line },
    });
    await new Promise((ok) => setTimeout(ok, 1100)); // be polite to the public server
  }
  const file: RoutesFile & { metadata: object } = {
    type: 'FeatureCollection',
    metadata: { router: 'OSRM bike profile with travel bearings, routing.openstreetmap.de (FOSSGIS)', data: '© OpenStreetMap contributors', fetched: new Date().toISOString().slice(0, 10) },
    features,
  };
  await writeFile(new URL('routes.geojson', OUT), JSON.stringify(file));
}

const MUNIS_GEOJSON =
  'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/833937f6-e190-49a2-9835-80137cf88c41/resource/4eadc3a3-bafa-44cf-a43f-f99a7fa98eb4/download/former-municipality-boundaries-data-4326.geojson';

/** Douglas–Peucker in degrees (fine at city scale for display). */
function simplify(ring: LngLat[], tol: number): LngLat[] {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = ring[a]!, [bx, by] = ring[b]!;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i]!;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-18;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return ring.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

async function munis() {
  const res = await fetch(MUNIS_GEOJSON);
  if (!res.ok) throw new Error(`municipalities HTTP ${res.status}`);
  const src = (await res.json()) as {
    features: { properties: { AREA_NAME: string }; geometry: { type: string; coordinates: LngLat[][][] | LngLat[][][][] } }[];
  };
  const features = src.features.map((f) => {
    const polys = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) as LngLat[][][];
    const coordinates = polys
      .map((rings) => rings.map((r) => simplify(r, 0.0003)).filter((r) => r.length >= 4))
      .filter((rings) => rings.length > 0);
    return { type: 'Feature', properties: { name: title(f.properties.AREA_NAME) }, geometry: { type: 'MultiPolygon', coordinates } };
  });
  const file = {
    type: 'FeatureCollection',
    metadata: { source: 'City of Toronto Open Data: Former Municipality Boundaries', licence: 'Open Government Licence – Toronto', fetched: new Date().toISOString().slice(0, 10) },
    features,
  };
  await writeFile(new URL('municipalities.geojson', OUT), JSON.stringify(file));
  console.log(`municipalities: ${features.map((f) => f.properties.name).join(', ')}`);
}

await mkdir(OUT, { recursive: true });
const only = process.argv[2];
if (!only || only === 'signals') await signals();
if (!only || only === 'routes') await routes();
if (!only || only === 'munis') await munis();
