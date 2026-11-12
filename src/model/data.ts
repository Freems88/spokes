/**
 * Glue between the cached /data GeoJSON files and a Scenario. Pure: callers
 * load the files (fetch in the browser, fs in the CLI) and pass them in.
 */
import { snapSignals } from './signals';
import type { LngLat, Scenario } from './types';

export interface RoutesFile {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { id: string; source: string; detourRatio: number; waypointsKey: string };
    geometry: { type: 'LineString'; coordinates: LngLat[] };
  }[];
}

export interface SignalsFile {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { px: string; name: string };
    geometry: { type: 'Point'; coordinates: LngLat };
  }[];
}

export const signalPoints = (f: SignalsFile): LngLat[] => f.features.map((x) => x.geometry.coordinates);

/** Ids used in routes.json: spoke ids plus "terminal". */
export const TERMINAL_ID = 'terminal';

/** A key for the waypoints a route was built from, so stale cache entries are ignored. */
export const waypointsKey = (pts: LngLat[]) => pts.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(';');

/** Waypoints sent to the router: the hand-drawn path if any, otherwise the stops. */
export function spokeWaypoints(sc: Scenario, id: string): LngLat[] {
  if (id === TERMINAL_ID) return sc.terminalPath?.length ? sc.terminalPath : [sc.merge.lngLat, sc.destination.lngLat];
  const s = sc.spokes.find((x) => x.id === id)!;
  return s.path?.length ? s.path : [s.start.lngLat, ...s.pickups.map((p) => p.lngLat), sc.merge.lngLat];
}

/**
 * Copy of the scenario with cached routed geometry (when its waypoints still
 * match) and signals snapped to every route.
 */
export function applyData(sc: Scenario, routes: RoutesFile | null, signals: LngLat[] | null): Scenario {
  const cache = routesByKey(routes);
  return resolveScenario(sc, (wps) => cache.get(waypointsKey(wps)) ?? null, signals ? (line) => snapSignals(line, signals) : null);
}

/** Routed lines from the cached file, keyed by the waypoints they were built from. */
export function routesByKey(routes: RoutesFile | null): Map<string, LngLat[]> {
  return new Map(routes?.features.map((f) => [f.properties.waypointsKey, f.geometry.coordinates]) ?? []);
}

/**
 * Copy of the scenario with each route replaced by its street-snapped line
 * when `lookup` has one for its current via points (straight segments
 * otherwise), and signals snapped to every route when `snap` is given.
 */
export function resolveScenario(
  sc: Scenario,
  lookup: (waypoints: LngLat[]) => LngLat[] | null,
  snap: ((line: LngLat[]) => number[]) | null,
): Scenario {
  const out: Scenario = structuredClone(sc);
  for (const s of out.spokes) {
    const wps = spokeWaypoints(sc, s.id);
    s.path = lookup(wps) ?? wps;
    if (snap) s.signalsAlongM = snap(s.path);
  }
  const twps = spokeWaypoints(sc, TERMINAL_ID);
  out.terminalPath = lookup(twps) ?? twps;
  if (snap) out.terminalSignalsAlongM = snap(out.terminalPath);
  return out;
}
