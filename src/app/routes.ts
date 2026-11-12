/**
 * Browser-side route snapping. Routes are cached by their via points, so a
 * route is fetched once per distinct shape; requests are debounced and sent
 * one at a time to stay polite to the public OSRM server. Anything not yet
 * routed (or that failed) is drawn as straight segments.
 */
import { waypointsKey } from '../model/data';
import { routeVia } from '../model/routing';
import type { LngLat } from '../model/types';

export type RouteStatus = 'routed' | 'straight' | 'pending';

interface Entry { line: LngLat[] | null; error?: string }

export class RouteService {
  private cache = new Map<string, Entry>();
  private queued = new Map<string, LngLat[]>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;

  constructor(initial: Map<string, LngLat[]>, private onUpdate: () => void, private delayMs = 700) {
    for (const [k, line] of initial) this.cache.set(k, { line });
  }

  /** Routed line for these via points, if we have one. */
  lookup = (wps: LngLat[]): LngLat[] | null => this.cache.get(waypointsKey(wps))?.line ?? null;

  status(wps: LngLat[]): RouteStatus {
    const key = waypointsKey(wps);
    const hit = this.cache.get(key);
    if (hit) return hit.line ? 'routed' : 'straight';
    return this.queued.has(key) || this.busy ? 'pending' : 'straight';
  }

  /** Ask for routes for these via-point lists; only unseen ones are fetched. */
  request(list: LngLat[][]): void {
    for (const wps of list) {
      const key = waypointsKey(wps);
      if (!this.cache.has(key) && wps.length >= 2) this.queued.set(key, wps);
    }
    if (!this.queued.size) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), this.delayMs);
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queued.size) {
        const [key, wps] = this.queued.entries().next().value as [string, LngLat[]];
        this.queued.delete(key);
        const res = await routeVia(wps);
        this.cache.set(key, res.source === 'straight' ? { line: null, error: res.error } : { line: res.line });
        this.onUpdate();
        if (this.queued.size) await new Promise((ok) => setTimeout(ok, 400));
      }
    } finally {
      this.busy = false;
    }
  }
}
