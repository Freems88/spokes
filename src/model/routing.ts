/**
 * Street snapping through a public OSRM server. Used at build time to cache
 * the default routes, and in the browser when points move. Callers must
 * fall back to straight segments when it fails.
 *
 * Profile: OSRM's bike profile, with each via point given the bearing of
 * travel so it snaps to the street being ridden rather than a cross street,
 * park path or platform. Without bearings both profiles loop around blocks;
 * with them the bike profile stays within ~3% of the street length, while
 * the car profile still detours ~15% (one-ways and turn bans).
 */
import { lengthM } from './geo';
import type { LngLat } from './types';

export const ROUTERS = {
  car: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
} as const;
export type Profile = keyof typeof ROUTERS;

export interface RouteResult {
  line: LngLat[];
  source: `osrm-${Profile}` | 'straight';
  /** Routed length ÷ straight-through-the-waypoints length. */
  detourRatio: number;
  error?: string;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Compass bearing a → b, degrees 0–359. */
export function bearing(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.round(Math.atan2(y, x) / r) + 360) % 360;
}

/** OSRM `bearings` value: direction of travel at each point (from its neighbours), ±60°. */
export function travelBearings(pts: LngLat[], range = 60): string {
  return pts.map((_, i) => `${bearing(pts[Math.max(0, i - 1)]!, pts[Math.min(pts.length - 1, i + 1)]!)},${range}`).join(';');
}

export async function routeVia(
  waypoints: LngLat[],
  opts: { fetchFn?: typeof fetch; maxDetour?: number; signal?: AbortSignal; profile?: Profile } = {},
): Promise<RouteResult> {
  const straight = lengthM(waypoints);
  const fallback = (error: string): RouteResult => ({ line: waypoints, source: 'straight', detourRatio: 1, error });
  if (waypoints.length < 2) return fallback('need at least two points');
  const coords = waypoints.map(([x, y]) => `${round(x)},${round(y)}`).join(';');
  const profile = opts.profile ?? 'bike';
  const url = `${ROUTERS[profile]}/${coords}?overview=full&geometries=geojson&continue_straight=true` +
    `&bearings=${travelBearings(waypoints)}&radiuses=${waypoints.map(() => 40).join(';')}`;
  try {
    const res = await (opts.fetchFn ?? fetch)(url, { signal: opts.signal });
    if (!res.ok) return fallback(`router HTTP ${res.status}`);
    const json = (await res.json()) as { code: string; routes?: { geometry: { coordinates: LngLat[] } }[] };
    const line = json.routes?.[0]?.geometry.coordinates;
    if (json.code !== 'Ok' || !line || line.length < 2) return fallback(`router said ${json.code}`);
    const detourRatio = straight > 0 ? lengthM(line) / straight : 1;
    if (detourRatio > (opts.maxDetour ?? 1.6)) return fallback(`route detours ×${detourRatio.toFixed(2)}`);
    return { line: line.map(([x, y]) => [round(x), round(y)]), source: `osrm-${profile}`, detourRatio };
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
}
