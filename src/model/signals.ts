import { cumulativeM, project } from './geo';
import type { LngLat } from './types';

/**
 * Positions (metres along `line`) of the signals within `maxM` of it.
 * Signals closer than `mergeM` to each other along the route count once:
 * one intersection is often listed as two signal records.
 */
export function snapSignals(line: LngLat[], signals: LngLat[], maxM = 15, mergeM = 25): number[] {
  if (line.length < 2 || signals.length === 0) return [];
  // Bounding-box prefilter (~maxM padding in degrees at Toronto's latitude).
  const padLat = maxM / 111_000 + 1e-5;
  const padLng = maxM / 80_000 + 1e-5;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of line) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const total = cumulativeM(line).at(-1)!;
  const hits: number[] = [];
  for (const s of signals) {
    if (s[0] < minX - padLng || s[0] > maxX + padLng || s[1] < minY - padLat || s[1] > maxY + padLat) continue;
    const pr = project(line, s);
    // Ignore signals sitting exactly at the very ends (the start/merge squares themselves).
    if (pr.offsetM <= maxM && pr.alongM > 1 && pr.alongM < total - 1) hits.push(pr.alongM);
  }
  hits.sort((a, b) => a - b);
  const out: number[] = [];
  for (const h of hits) if (!out.length || h - out.at(-1)! > mergeM) out.push(h);
  return out;
}
